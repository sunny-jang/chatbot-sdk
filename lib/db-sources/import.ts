import { randomUUID } from "node:crypto";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { PortalError } from "@/lib/customer-portal/validation";
import { getEmbeddings, fakeEmbeddingsEnabled } from "@/lib/embeddings";
import { connectorFor } from "@/lib/data-connections/connectors";
import { credentialsOf, type DataConnectionRow } from "@/lib/data-connections/store";
import type { RowQuery } from "@/lib/data-connections/types";
import { renderRowDocument, rowHash, rowKeyOf } from "./render";
import { configOf, type DbSourceRow } from "./store";
import { IMPORT_STEP, type SourceConfig, type SyncResult } from "./types";

export type ImportState = {
  cursor: unknown;
  processed: number;
  total: number;
  truncated: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  done: boolean;
  archived: number;
  deleted: number;
};
const LOCK_TTL = 600;

export function rowQueryOf(config: SourceConfig): RowQuery {
  const columns = [...new Set([config.titleColumn, ...config.bodyColumns.map((b) => b.column)])];
  return { schema: config.schema, table: config.table, columns, keyColumn: config.keyColumn, filters: config.filters };
}

export async function liveConnection(db: AccessDatabase, source: DbSourceRow) {
  const [conn] = await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE id=${source.connection_id}`;
  if (!conn || conn.status === "deleted") throw new PortalError("연결이 삭제됐어요. 데이터 연결을 다시 만들고 소스를 수정해주세요.", 409);
  return conn;
}

/** 첫 단계: 행 수를 세고 잠금(sync_locked_at = 실행 시작 시각)을 건다. 이미 진행 중이면 409. */
export async function beginImport(source: DbSourceRow): Promise<ImportState> {
  const now = Math.floor(Date.now() / 1000);
  const [locked] = await sql`UPDATE db_sources SET sync_locked_at=${now} WHERE id=${source.id} AND (sync_locked_at IS NULL OR sync_locked_at < ${now - LOCK_TTL}) RETURNING id`;
  if (!locked) throw new PortalError("이미 동기화 중이에요. 잠시 후 다시 시도해주세요.", 409);
  try {
    const conn = await liveConnection(sql as AccessDatabase, source);
    const config = configOf(source);
    const count = await connectorFor(conn.kind).countRows(credentialsOf(conn), rowQueryOf(config));
    const total = Math.min(count, config.rowLimit);
    return { cursor: null, processed: 0, total, truncated: Math.max(0, count - config.rowLimit), created: 0, updated: 0, unchanged: 0, failed: 0, done: total === 0, archived: 0, deleted: 0 };
  } catch (e) {
    await failImport(source, e);
    throw e;
  }
}

/** 한 단계: 커서 다음 행을 IMPORT_STEP개 읽어 문서로 반영한다. 끝나면 finalize까지 수행한다. */
export async function importStep(source: DbSourceRow, state: ImportState, openaiKey: string | null): Promise<ImportState> {
  const next = { ...state };
  try {
    if (!state.done) {
      const conn = await liveConnection(sql as AccessDatabase, source);
      const config = configOf(source);
      const remaining = Math.max(0, config.rowLimit - state.processed);
      const batch = Math.max(1, Math.min(IMPORT_STEP, remaining));
      let rows: Record<string, unknown>[] = [];
      let lastKey: unknown = undefined;
      if (remaining > 0)
        await connectorFor(conn.kind).readRows(
          credentialsOf(conn),
          rowQueryOf(config),
          async (b, raw) => {
            rows = b;
            lastKey = raw;
            return false;
          },
          batch,
          state.cursor,
        );
      if (rows.length) {
        const applied = await applyRows(source, config, rows, openaiKey, `${config.schema === "public" ? "" : config.schema + "."}${config.table}`);
        next.created += applied.created;
        next.updated += applied.updated;
        next.unchanged += applied.unchanged;
        next.failed += applied.failed;
        next.processed += rows.length;
        next.cursor = lastKey;
      }
      next.done = !rows.length || rows.length < batch || next.processed >= config.rowLimit;
    }
    if (next.done) {
      const final = await finalizeImport(source, next);
      next.archived = final.archived;
      next.deleted = final.deleted;
    } else {
      await sql`UPDATE db_sources SET sync_locked_at=${Math.floor(Date.now() / 1000)}, last_result=${sql.json(resultOf(next))} WHERE id=${source.id}`;
    }
    return next;
  } catch (e) {
    await failImport(source, e);
    throw e;
  }
}

function resultOf(state: ImportState, error?: string): SyncResult {
  return {
    created: state.created,
    updated: state.updated,
    unchanged: state.unchanged,
    archived: state.archived,
    deleted: state.deleted,
    failed: state.failed,
    truncated: state.truncated,
    total: state.total,
    finishedAt: Math.floor(Date.now() / 1000),
    ...(error ? { error } : {}),
  };
}

export async function applyRows(
  source: DbSourceRow,
  config: SourceConfig,
  rows: Record<string, unknown>[],
  openaiKey: string | null,
  tableLabel: string,
) {
  const counters = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  const docs = rows.map((row) => {
    const key = rowKeyOf(row[config.keyColumn]);
    const rendered = renderRowDocument(row, { titleColumn: config.titleColumn, bodyColumns: config.bodyColumns, tableLabel });
    return { key, ...rendered, hash: rowHash(rendered.title, rendered.content) };
  });
  const valid = docs.filter((d) => d.key !== "");
  counters.failed += docs.length - valid.length;
  const keys = valid.map((d) => d.key);
  const existing = await sql`SELECT row_key,row_hash,document_id,status FROM db_source_rows WHERE source_id=${source.id} AND row_key=ANY(${keys}::text[])`;
  const byKey = new Map(existing.map((r) => [String(r.row_key), r]));
  const toEmbed = valid.filter((d) => {
    const e = byKey.get(d.key);
    return !e || e.row_hash !== d.hash || !e.document_id;
  });
  if (toEmbed.length && !openaiKey && !fakeEmbeddingsEnabled()) throw new PortalError("OpenAI API 키를 등록해주세요.");
  const vectors = toEmbed.length ? await getEmbeddings(toEmbed.map((d) => d.content.slice(0, 8000)), openaiKey) : [];
  const vectorOf = new Map(toEmbed.map((d, i) => [d.key, vectors[i]]));
  const now = Math.floor(Date.now() / 1000);
  await sql.begin(async (tx) => {
    for (const d of valid) {
      const e = byKey.get(d.key);
      const vector = vectorOf.get(d.key);
      if (e && e.document_id && !vector) {
        await tx`UPDATE db_source_rows SET status='active', synced_at=${now} WHERE source_id=${source.id} AND row_key=${d.key}`;
        if (e.status === "archived") await tx`UPDATE documents SET archived_at=NULL WHERE id=${e.document_id}`;
        counters.unchanged++;
        continue;
      }
      if (!vector || vector.some((v) => !Number.isFinite(v))) {
        counters.failed++;
        continue;
      }
      if (e && e.document_id) {
        await tx`UPDATE documents SET title=${d.title}, content=${d.content}, embedding=${JSON.stringify(vector)}, folder_id=${config.folderId}, archived_at=NULL, source_kind='db' WHERE id=${e.document_id} AND bot_id=${source.bot_id}`;
        await tx`UPDATE db_source_rows SET row_hash=${d.hash}, status='active', synced_at=${now} WHERE source_id=${source.id} AND row_key=${d.key}`;
        counters.updated++;
      } else {
        const docId = randomUUID();
        await tx`INSERT INTO documents(id,bot_id,folder_id,title,content,embedding,source_kind) VALUES(${docId},${source.bot_id},${config.folderId},${d.title},${d.content},${JSON.stringify(vector)},'db')`;
        await tx`INSERT INTO db_source_rows(source_id,row_key,row_hash,document_id,status,synced_at) VALUES(${source.id},${d.key},${d.hash},${docId},'active',${now})
          ON CONFLICT(source_id,row_key) DO UPDATE SET row_hash=EXCLUDED.row_hash, document_id=EXCLUDED.document_id, status='active', synced_at=EXCLUDED.synced_at`;
        counters.created++;
      }
    }
  });
  return counters;
}

/** 실행 시작(sync_locked_at) 이후 갱신되지 않은 행 = 사라진 행. 보관(기본) 또는 삭제. */
export async function finalizeImport(source: DbSourceRow, state: ImportState) {
  const [current] = await sql`SELECT sync_locked_at, missing_rows, schedule FROM db_sources WHERE id=${source.id}`;
  const startedAt = Number(current?.sync_locked_at ?? 0);
  let archived = 0,
    deleted = 0;
  await sql.begin(async (tx) => {
    const missing = await tx`SELECT row_key, document_id FROM db_source_rows WHERE source_id=${source.id} AND synced_at < ${startedAt} AND status='active'`;
    const docIds = missing.map((m) => m.document_id).filter((x): x is string => typeof x === "string");
    if (current?.missing_rows === "delete") {
      if (docIds.length) await tx`DELETE FROM documents WHERE id=ANY(${docIds}::text[]) AND bot_id=${source.bot_id}`;
      await tx`DELETE FROM db_source_rows WHERE source_id=${source.id} AND synced_at < ${startedAt}`;
      deleted = missing.length;
    } else {
      if (docIds.length) await tx`UPDATE documents SET archived_at=COALESCE(archived_at,${startedAt}) WHERE id=ANY(${docIds}::text[]) AND bot_id=${source.bot_id}`;
      await tx`UPDATE db_source_rows SET status='archived' WHERE source_id=${source.id} AND synced_at < ${startedAt} AND status='active'`;
      archived = missing.length;
    }
    const { nextSyncAt } = await import("./store");
    await tx`UPDATE db_sources SET sync_locked_at=NULL, last_synced_at=${Math.floor(Date.now() / 1000)}, next_sync_at=${nextSyncAt(String(current?.schedule) as DbSourceRow["schedule"])},
      last_result=${tx.json(resultOf({ ...state, archived, deleted }))}, last_error=NULL, consecutive_failures=0, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${source.id}`;
  });
  return { archived, deleted };
}

export async function failImport(source: DbSourceRow, error: unknown) {
  const message = error instanceof PortalError ? error.message : "동기화 중 오류가 났어요. 잠시 후 다시 시도해주세요.";
  await sql`UPDATE db_sources SET sync_locked_at=NULL, last_error=${message}, consecutive_failures=consecutive_failures+1,
    last_result=${sql.json({ created: 0, updated: 0, unchanged: 0, archived: 0, deleted: 0, failed: 0, truncated: 0, total: 0, finishedAt: Math.floor(Date.now() / 1000), error: message })},
    updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${source.id}`.catch(() => null);
}
