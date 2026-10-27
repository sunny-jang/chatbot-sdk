import { randomUUID } from "node:crypto";
import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { PortalError } from "@/lib/customer-portal/validation";
import { getEmbeddings, fakeEmbeddingsEnabled } from "@/lib/embeddings";
import { connectorFor } from "@/lib/data-connections/connectors";
import { credentialsOf, type DataConnectionRow } from "@/lib/data-connections/store";
import type { RowQuery } from "@/lib/data-connections/types";
import { numericFieldsOf, renderRowDocument, rowHash, rowKeyOf } from "./render";
import { configOf, type DbSourceRow } from "./store";
import { EMBED_REQUEST_CHARS, IMPORT_STEP, type SourceConfig, type SyncResult } from "./types";

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
  /** 누가 시작했는지. 자동 동기화(cron)는 다음 호출에서 이어 받고, 화면(manual) 실행은 브라우저가 이어 간다. */
  runner?: "manual" | "cron";
  /** 이번 실행 식별자. 이번 실행에서 본 행에 기록하고, 끝날 때 기록이 없는 행을 사라진 행으로 본다. */
  runId?: string;
};
export const LOCK_TTL = 600;
type Db = typeof sql;
/** 바깥 트랜잭션 안(검사)에서는 savepoint, 아니면 새 트랜잭션. */
async function withTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const nested = db as unknown as { savepoint?: (f: (tx: Db) => Promise<T>) => Promise<T> };
  if (typeof nested.savepoint === "function") return nested.savepoint(fn);
  return (await db.begin((tx) => fn(tx as unknown as Db))) as T;
}

export function rowQueryOf(config: SourceConfig): RowQuery {
  const columns = [...new Set([config.titleColumn, ...config.bodyColumns.map((b) => b.column)])];
  return { schema: config.schema, table: config.table, columns, keyColumn: config.keyColumn, filters: config.filters };
}

export async function liveConnection(db: AccessDatabase, source: DbSourceRow) {
  const [conn] = await db<DataConnectionRow[]>`SELECT * FROM data_connections WHERE id=${source.connection_id}`;
  if (!conn || conn.status === "deleted") throw new PortalError("연결이 삭제됐어요. 데이터 연결을 다시 만들고 소스를 수정해주세요.", 409);
  return conn;
}

/** 첫 단계: 잠금을 걸고 행 수·고유키 중복을 확인한 뒤 진행 상태를 서버에 저장한다. 이미 진행 중이면 409. */
export async function beginImport(source: DbSourceRow, db: Db = sql, runner: "manual" | "cron" = "manual"): Promise<ImportState> {
  const now = Math.floor(Date.now() / 1000);
  const [locked] = await db`UPDATE db_sources SET sync_locked_at=${now}, sync_started_at=${now}, sync_state=NULL WHERE id=${source.id} AND (sync_locked_at IS NULL OR sync_locked_at < ${now - LOCK_TTL}) RETURNING id`;
  if (!locked) throw new PortalError("이미 동기화 중이에요. 잠시 후 다시 시도해주세요.", 409);
  try {
    const conn = await liveConnection(db as unknown as AccessDatabase, source);
    const config = configOf(source);
    const { total: count, distinctKeys } = await connectorFor(conn.kind).countRows(credentialsOf(conn), rowQueryOf(config));
    // 고유키에 같은 값·빈 값이 있으면 키 순서로 이어 읽을 때 행이 빠지고 문서가 중복된다.
    if (distinctKeys !== count)
      throw new PortalError(
        `고유키로 고른 ${config.keyColumn} 컬럼에 같은 값이나 빈 값이 있어요(${count.toLocaleString("ko-KR")}행 중 서로 다른 값 ${distinctKeys.toLocaleString("ko-KR")}개). 행마다 다른 값이 들어 있는 컬럼(예: id)을 골라주세요.`,
      );
    const total = Math.min(count, config.rowLimit);
    const state: ImportState = { cursor: null, processed: 0, total, truncated: Math.max(0, count - config.rowLimit), created: 0, updated: 0, unchanged: 0, failed: 0, done: total === 0, archived: 0, deleted: 0, runner, runId: randomUUID() };
    await db`UPDATE db_sources SET sync_state=${db.json(state as never)} WHERE id=${source.id}`;
    return state;
  } catch (e) {
    await failImport(source, e, db, runner === "cron");
    throw e;
  }
}

/** 진행 중인 실행의 상태를 서버에서 읽는다. 잠금이 없거나 만료됐으면 처음부터 다시 시작해야 한다. */
export async function currentImport(source: DbSourceRow, db: Db = sql): Promise<ImportState> {
  const now = Math.floor(Date.now() / 1000);
  const [row] = await db`SELECT sync_state, sync_locked_at FROM db_sources WHERE id=${source.id}`;
  if (!row?.sync_state || !row.sync_locked_at || Number(row.sync_locked_at) < now - LOCK_TTL)
    throw new PortalError("진행 중인 가져오기가 없어요. 처음부터 다시 시작해주세요.", 409);
  return row.sync_state as ImportState;
}

/** 한 단계: 서버에 저장된 커서 다음 행을 IMPORT_STEP개 읽어 문서로 반영한다. 끝나면 finalize까지 수행한다. */
export async function importStep(source: DbSourceRow, openaiKey: string | null, db: Db = sql, countFailure = false): Promise<ImportState> {
  try {
    const state = await currentImport(source, db);
    const next = { ...state };
    if (!state.done) {
      const conn = await liveConnection(db as unknown as AccessDatabase, source);
      const config = configOf(source);
      const remaining = Math.max(0, Math.min(config.rowLimit, state.total) - state.processed);
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
        const applied = await applyRows(source, config, rows, openaiKey, `${config.schema === "public" ? "" : config.schema + "."}${config.table}`, db, state.runId ?? null);
        next.created += applied.created;
        next.updated += applied.updated;
        next.unchanged += applied.unchanged;
        next.failed += applied.failed;
        next.processed += rows.length;
        next.cursor = typeof lastKey === "bigint" ? String(lastKey) : lastKey instanceof Date ? lastKey.toISOString() : lastKey;
      }
      next.done = remaining === 0 || !rows.length || rows.length < batch || next.processed >= Math.min(config.rowLimit, state.total);
    }
    if (next.done) {
      const final = await finalizeImport(source, next, db);
      next.archived = final.archived;
      next.deleted = final.deleted;
    } else {
      await db`UPDATE db_sources SET sync_locked_at=${Math.floor(Date.now() / 1000)}, sync_state=${db.json(next as never)}, last_result=${db.json(resultOf(next))} WHERE id=${source.id}`;
    }
    return next;
  } catch (e) {
    await failImport(source, e, db, countFailure);
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
  db: Db = sql,
  runId: string | null = null,
) {
  const counters = { created: 0, updated: 0, unchanged: 0, failed: 0 };
  const docs = rows.map((row) => {
    const key = rowKeyOf(row[config.keyColumn]);
    const rendered = renderRowDocument(row, { titleColumn: config.titleColumn, bodyColumns: config.bodyColumns, tableLabel });
    return { key, ...rendered, hash: rowHash(rendered.title, rendered.content), numeric: numericFieldsOf(row, config.bodyColumns) };
  });
  const valid = docs.filter((d) => d.key !== "");
  counters.failed += docs.length - valid.length;
  const keys = valid.map((d) => d.key);
  const existing = await db`SELECT row_key,row_hash,document_id,status FROM db_source_rows WHERE source_id=${source.id} AND row_key=ANY(${keys}::text[])`;
  const byKey = new Map(existing.map((r) => [String(r.row_key), r]));
  const toEmbed = valid.filter((d) => {
    const e = byKey.get(d.key);
    return !e || e.row_hash !== d.hash || !e.document_id;
  });
  if (toEmbed.length && !openaiKey && !fakeEmbeddingsEnabled()) throw new PortalError("OpenAI API 키를 등록해주세요.");
  // 요청당 토큰 한도를 넘지 않게 본문 길이 합으로 나눠 보낸다.
  const vectors: number[][] = [];
  let chunk: string[] = [],
    chars = 0;
  for (const d of toEmbed) {
    const text = d.content.slice(0, 8000);
    if (chunk.length && chars + text.length > EMBED_REQUEST_CHARS) {
      vectors.push(...(await getEmbeddings(chunk, openaiKey)));
      chunk = [];
      chars = 0;
    }
    chunk.push(text);
    chars += text.length;
  }
  if (chunk.length) vectors.push(...(await getEmbeddings(chunk, openaiKey)));
  const vectorOf = new Map(toEmbed.map((d, i) => [d.key, vectors[i]]));
  const now = Math.floor(Date.now() / 1000);
  await withTx(db, async (tx) => {
    for (const d of valid) {
      const e = byKey.get(d.key);
      const vector = vectorOf.get(d.key);
      if (e && e.document_id && !vector) {
        await tx`UPDATE db_source_rows SET status='active', synced_at=${now}, run_id=${runId} WHERE source_id=${source.id} AND row_key=${d.key}`;
        // 숫자 필드는 본문이 같아도 채워 둔다(이전 버전에서 가져온 문서 보강).
        await tx`UPDATE documents SET numeric_fields=${tx.json(d.numeric as never)}${e.status === "archived" ? tx`, archived_at=NULL` : tx``} WHERE id=${e.document_id}`;
        counters.unchanged++;
        continue;
      }
      if (!vector || vector.some((v) => !Number.isFinite(v))) {
        counters.failed++;
        continue;
      }
      if (e && e.document_id) {
        await tx`UPDATE documents SET title=${d.title}, content=${d.content}, embedding=${JSON.stringify(vector)}, folder_id=${config.folderId}, archived_at=NULL, source_kind='db', numeric_fields=${tx.json(d.numeric as never)} WHERE id=${e.document_id} AND bot_id=${source.bot_id}`;
        await tx`UPDATE db_source_rows SET row_hash=${d.hash}, status='active', synced_at=${now}, run_id=${runId} WHERE source_id=${source.id} AND row_key=${d.key}`;
        counters.updated++;
      } else {
        const docId = randomUUID();
        await tx`INSERT INTO documents(id,bot_id,folder_id,title,content,embedding,source_kind,numeric_fields) VALUES(${docId},${source.bot_id},${config.folderId},${d.title},${d.content},${JSON.stringify(vector)},'db',${tx.json(d.numeric as never)})`;
        await tx`INSERT INTO db_source_rows(source_id,row_key,row_hash,document_id,status,synced_at,run_id) VALUES(${source.id},${d.key},${d.hash},${docId},'active',${now},${runId})
          ON CONFLICT(source_id,row_key) DO UPDATE SET row_hash=EXCLUDED.row_hash, document_id=EXCLUDED.document_id, status='active', synced_at=EXCLUDED.synced_at, run_id=EXCLUDED.run_id`;
        counters.created++;
      }
    }
  });
  return counters;
}

/** 실행 시작(sync_started_at) 이후 갱신되지 않은 행 = 사라진 행. 보관(기본) 또는 삭제. */
export async function finalizeImport(source: DbSourceRow, state: ImportState, db: Db = sql) {
  const [current] = await db`SELECT sync_started_at, missing_rows, schedule FROM db_sources WHERE id=${source.id}`;
  const startedAt = Number(current?.sync_started_at ?? 0);
  let archived = 0,
    deleted = 0;
  await withTx(db, async (tx) => {
    const runId = state.runId ?? null;
    const missing = runId
      ? await tx`SELECT row_key, document_id FROM db_source_rows WHERE source_id=${source.id} AND run_id IS DISTINCT FROM ${runId} AND status='active'`
      : await tx`SELECT row_key, document_id FROM db_source_rows WHERE source_id=${source.id} AND synced_at < ${startedAt} AND status='active'`;
    const missingKeys = missing.map((m) => String(m.row_key));
    const docIds = missing.map((m) => m.document_id).filter((x): x is string => typeof x === "string");
    if (current?.missing_rows === "delete") {
      if (docIds.length) await tx`DELETE FROM documents WHERE id=ANY(${docIds}::text[]) AND bot_id=${source.bot_id}`;
      if (missingKeys.length) await tx`DELETE FROM db_source_rows WHERE source_id=${source.id} AND row_key=ANY(${missingKeys}::text[])`;
      deleted = missing.length;
    } else {
      if (docIds.length) await tx`UPDATE documents SET archived_at=COALESCE(archived_at,${startedAt}) WHERE id=ANY(${docIds}::text[]) AND bot_id=${source.bot_id}`;
      if (missingKeys.length) await tx`UPDATE db_source_rows SET status='archived' WHERE source_id=${source.id} AND row_key=ANY(${missingKeys}::text[])`;
      archived = missing.length;
    }
    const { nextSyncAt } = await import("./store");
    await tx`UPDATE db_sources SET sync_locked_at=NULL, sync_state=NULL, last_synced_at=${Math.floor(Date.now() / 1000)}, next_sync_at=${nextSyncAt(String(current?.schedule) as DbSourceRow["schedule"])},
      last_result=${tx.json(resultOf({ ...state, archived, deleted }))}, last_error=NULL, consecutive_failures=0, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${source.id}`;
  });
  return { archived, deleted };
}

/** 실패 기록. 자동 동기화(cron)만 연속 실패 횟수를 올린다 — 화면에서 누른 가져오기 실패로 예약 동기화가 멈추지 않게. */
export async function failImport(source: DbSourceRow, error: unknown, db: Db = sql, countFailure = false) {
  const message = error instanceof PortalError ? error.message : "동기화 중 오류가 났어요. 잠시 후 다시 시도해주세요.";
  await db`UPDATE db_sources SET sync_locked_at=NULL, sync_state=NULL, last_error=${message}, consecutive_failures=consecutive_failures+${countFailure ? 1 : 0},
    last_result=${db.json({ created: 0, updated: 0, unchanged: 0, archived: 0, deleted: 0, failed: 0, truncated: 0, total: 0, finishedAt: Math.floor(Date.now() / 1000), error: message })},
    updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=${source.id}`.catch(() => null);
}
