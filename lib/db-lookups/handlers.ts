import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { adminBot, failure, jsonBody, OperationError } from "@/lib/operations/http";
import { portalUser } from "@/lib/customer-portal/auth";
import { PortalError, text } from "@/lib/customer-portal/validation";
import { connectorFor } from "@/lib/data-connections/connectors";
import { splitTableName } from "@/lib/data-connections/identifiers";
import { assertDbKnowledgeAllowed, credentialsOf, tenantDbRowLimit } from "@/lib/data-connections/store";
import { connectionForBot, listConnectionsForBot } from "@/lib/db-sources/store";
import { isPersonalDataColumn, labelFor, unitFor } from "@/lib/db-sources/render";
import { lookupConfig } from "./config";
import { runLookup } from "./run";
import { assertColumnsExist, createLookup, dbLookup, deleteLookup, listLookups, setLookupEnabled, updateLookup, type DbLookupRow } from "./store";

type Context = { params: Promise<{ id: string }> };
const db = sql as unknown as AccessDatabase;

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof PortalError) throw new OperationError(e.message, e.status);
    throw e;
  });
}
async function botRef(id: string, allowCustomer: boolean) {
  const { tenantId } = await adminBot(id, db, false, allowCustomer);
  const [row] = await db`SELECT id, customer_id, model, type FROM bots WHERE id=${id} AND tenant_id=${tenantId}`;
  if (!row) throw new OperationError("챗봇을 찾을 수 없습니다.", 404);
  return { tenantId, model: String(row.model ?? ""), type: String(row.type ?? ""), b: { id: String(row.id), customer_id: row.customer_id ? String(row.customer_id) : null } };
}
async function actorOf(tenantId: string) {
  try {
    const user = await portalUser();
    return { userId: user.id, tenantId };
  } catch {
    return { userId: null, tenantId };
  }
}

export async function readLookups(_: Request, { params }: Context, allowCustomer = false) {
  try {
    const { id } = await params;
    const { b, tenantId, model, type } = await botRef(id, allowCustomer);
    const [connections, lookups, limit] = await Promise.all([listConnectionsForBot(db, b), listLookups(db, id), tenantDbRowLimit(db, tenantId)]);
    return Response.json({
      assigned: Boolean(b.customer_id),
      planAllowed: limit > 0,
      // 도구 호출은 OpenAI 모델에서만 쓴다.
      modelSupported: !model.startsWith("gemini-"),
      // Q&A 챗봇은 방문자가 "AI에게 질문하기"를 고른 대화에서만 조회를 쓴다.
      qaBot: type === "qa",
      connections,
      lookups,
    });
  } catch (e) {
    return failure(e);
  }
}

/** 표의 실제 컬럼 이름. 저장할 때 개인정보 추정·존재 여부를 표 전체 기준으로 판단하려고 읽는다. */
async function tableColumns(b: { id: string; customer_id: string | null }, connectionId: string, schema: string, table: string) {
  const conn = await connectionForBot(db, b, connectionId);
  const sample = await connectorFor(conn.kind).sample(credentialsOf(conn), schema, table, 1);
  return sample.columns.map((c) => c.name);
}

export async function manageLookups(req: Request, { params }: Context, allowCustomer = false) {
  try {
    const { id } = await params;
    const { b, tenantId } = await botRef(id, allowCustomer);
    const body = await jsonBody(req);
    const action = String(body.action ?? "");
    const actor = await actorOf(tenantId);

    if (action === "tables") {
      await wrap(assertDbKnowledgeAllowed(db, tenantId));
      const conn = await wrap(connectionForBot(db, b, text(body.connectionId, "데이터 연결", 200)));
      return Response.json({ tables: await wrap(connectorFor(conn.kind).listTables(credentialsOf(conn))) });
    }
    if (action === "sample") {
      await wrap(assertDbKnowledgeAllowed(db, tenantId));
      const conn = await wrap(connectionForBot(db, b, text(body.connectionId, "데이터 연결", 200)));
      const { schema, table } = splitTableName(body.table);
      const sample = await wrap(connectorFor(conn.kind).sample(credentialsOf(conn), schema, table, 5));
      const names = sample.columns.map((c) => c.name);
      // 화면에서 개인정보 추정 컬럼을 막고 라벨·단위 기본값을 채우도록 서버 규칙으로 계산해 보낸다.
      const columns = sample.columns.map((c) => ({ ...c, personal: isPersonalDataColumn(c.name, names), label: labelFor(c.name), unit: unitFor(c.name, c.type) }));
      return Response.json({ schema, table, columns, rows: sample.rows });
    }
    if (action === "create" || action === "update") {
      const existing = action === "update" ? await wrap(dbLookup(db, id, text(body.lookupId, "조회", 200))) : null;
      const connectionId = body.connectionId ? text(body.connectionId, "데이터 연결", 200) : existing?.connection_id ?? "";
      const schema = typeof body.schema === "string" && body.schema ? body.schema : existing?.schema_name ?? "public";
      const table = typeof body.table === "string" && body.table ? body.table : existing?.table_name ?? "";
      if (!connectionId || !table) throw new OperationError("데이터 연결과 테이블을 골라주세요.");
      // 요금제 확인을 고객사 DB 접속보다 먼저 한다.
      await wrap(assertDbKnowledgeAllowed(db, tenantId));
      const columns = await wrap(tableColumns(b, connectionId, schema, table));
      if (action === "create")
        return Response.json(await wrap(sql.begin((tx) => createLookup(tx as unknown as AccessDatabase, actor, b, body, columns))), { status: 201 });
      return Response.json(await wrap(sql.begin((tx) => updateLookup(tx as unknown as AccessDatabase, actor, b, existing!.id, body, columns))));
    }
    if (action === "toggle")
      return Response.json(await wrap(sql.begin((tx) => setLookupEnabled(tx as unknown as AccessDatabase, actor, b, text(body.lookupId, "조회", 200), body.enabled === true))));
    if (action === "delete")
      return Response.json(await wrap(sql.begin((tx) => deleteLookup(tx as unknown as AccessDatabase, actor, b, text(body.lookupId, "조회", 200)))));
    if (action === "test") {
      // 저장된 조회(lookupId) 또는 저장 전 설정(body.config)을 테스트 값(body.args)으로 실행한다.
      await wrap(assertDbKnowledgeAllowed(db, tenantId));
      let lookup: DbLookupRow;
      if (body.lookupId) lookup = await wrap(dbLookup(db, id, text(body.lookupId, "조회", 200)));
      else {
        const input = (body.config ?? {}) as Record<string, unknown>;
        // 저장 때와 같은 검사: 표 전체 컬럼 기준 개인정보 추정·존재 여부.
        const draft = await wrap(Promise.resolve().then(() => lookupConfig(input)));
        const columns = await wrap(tableColumns(b, draft.connectionId, draft.schema, draft.table));
        const config = await wrap(Promise.resolve().then(() => lookupConfig(input, columns)));
        await wrap(Promise.resolve().then(() => assertColumnsExist(config, columns)));
        lookup = {
          id: "",
          bot_id: id,
          connection_id: config.connectionId,
          name: config.name,
          description: config.description,
          schema_name: config.schema,
          table_name: config.table,
          params: config.params,
          outputs: config.outputs,
          filters: config.filters,
          max_rows: config.maxRows,
          enabled: true,
          created_at: 0,
          updated_at: 0,
        };
      }
      await wrap(connectionForBot(db, b, lookup.connection_id));
      const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
      const result = await runLookup(db, lookup, args, { botId: id, sessionId: null, test: true });
      return Response.json({ result });
    }
    throw new OperationError("요청을 확인해주세요.");
  } catch (e) {
    return failure(e);
  }
}
