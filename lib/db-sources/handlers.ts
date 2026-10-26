import sql from "@/lib/neon";
import type { AccessDatabase } from "@/lib/access/schema";
import { adminBot, failure, jsonBody, OperationError } from "@/lib/operations/http";
import { portalUser } from "@/lib/customer-portal/auth";
import { PortalError, text } from "@/lib/customer-portal/validation";
import { getTenantApiKeyByTenantId } from "@/lib/tenantKey";
import { getEmbeddings, cosineSimilarity } from "@/lib/embeddings";
import { connectorFor } from "@/lib/data-connections/connectors";
import { splitTableName } from "@/lib/data-connections/identifiers";
import { credentialsOf } from "@/lib/data-connections/store";
import { draftWithAi } from "./draft";
import { renderRowDocument } from "./render";
import { beginImport, importStep, rowQueryOf, type ImportState } from "./import";
import { connectionForBot, createDbSource, dbSource, deleteDbSource, listConnectionsForBot, listDbSources, sourceConfig, updateDbSource } from "./store";
import { PREVIEW_DOCS } from "./types";
import OpenAI from "openai";

type Context = { params: Promise<{ id: string }> };
const db = sql as unknown as AccessDatabase;

/** PortalError를 OperationError로 바꿔 failure()가 상태 코드를 그대로 쓰게 한다. */
function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof PortalError) throw new OperationError(e.message, e.status);
    throw e;
  });
}
async function actorOf(tenantId: string) {
  try {
    const user = await portalUser();
    return { userId: user.id, tenantId };
  } catch {
    return { userId: null, tenantId };
  }
}

export async function readDbSources(_: Request, { params }: Context, allowCustomer = false) {
  try {
    const { id } = await params;
    const { bot } = await adminBot(id, db, false, allowCustomer);
    const b = { id: String(bot.id), customer_id: bot.customer_id ? String(bot.customer_id) : null };
    const [connections, sources] = await Promise.all([listConnectionsForBot(db, b), listDbSources(db, id)]);
    return Response.json({ assigned: Boolean(b.customer_id), connections, sources });
  } catch (e) {
    return failure(e);
  }
}

export async function manageDbSources(req: Request, { params }: Context, allowCustomer = false) {
  try {
    const { id } = await params;
    const { bot, tenantId } = await adminBot(id, db, false, allowCustomer);
    const b = { id: String(bot.id), customer_id: bot.customer_id ? String(bot.customer_id) : null };
    const body = await jsonBody(req);
    const action = String(body.action ?? "");
    if (action === "tables") {
      const conn = await wrap(connectionForBot(db, b, text(body.connectionId, "데이터 연결", 200)));
      return Response.json({ tables: await wrap(connectorFor(conn.kind).listTables(credentialsOf(conn))) });
    }
    if (action === "sample" || action === "draft") {
      const conn = await wrap(connectionForBot(db, b, text(body.connectionId, "데이터 연결", 200)));
      const { schema, table } = splitTableName(body.table);
      const sample = await wrap(connectorFor(conn.kind).sample(credentialsOf(conn), schema, table, 10));
      if (action === "sample") return Response.json({ schema, table, ...sample });
      const key = await getTenantApiKeyByTenantId(tenantId);
      const draft = await draftWithAi(sample.columns, sample.rows, table, key);
      return Response.json({ schema, table, ...sample, draft });
    }
    if (action === "preview") {
      const config = await wrap(Promise.resolve(sourceConfig(body)));
      const conn = await wrap(connectionForBot(db, b, config.connectionId));
      const tableLabel = `${config.schema === "public" ? "" : config.schema + "."}${config.table}`;
      let rows: Record<string, unknown>[] = [];
      await wrap(connectorFor(conn.kind).readRows(credentialsOf(conn), rowQueryOf(config), async (batch) => { rows = batch; return false; }, PREVIEW_DOCS));
      const documents = rows.map((r) => renderRowDocument(r, { titleColumn: config.titleColumn, bodyColumns: config.bodyColumns, tableLabel }));
      const questions = (Array.isArray(body.questions) ? body.questions : []).filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 3).map((q) => q.trim().slice(0, 200));
      const answers = documents.length && questions.length ? await answerPreview(tenantId, documents, questions) : [];
      return Response.json({ documents, answers });
    }
    const actor = await actorOf(tenantId);
    if (action === "create")
      return Response.json(await wrap(sql.begin((tx) => createDbSource(tx as unknown as AccessDatabase, { ...actor, customerId: b.customer_id }, b, body))), { status: 201 });
    if (action === "update")
      return Response.json(await wrap(sql.begin((tx) => updateDbSource(tx as unknown as AccessDatabase, actor, b, text(body.sourceId, "소스", 200), body))));
    if (action === "delete")
      return Response.json(await wrap(sql.begin((tx) => deleteDbSource(tx as unknown as AccessDatabase, actor, b, text(body.sourceId, "소스", 200), body.documents === "delete" ? "delete" : "archive"))));
    if (action === "import") {
      // 가져오기는 단계별로 호출한다: state 없이 시작 → 돌려받은 state를 다시 보내 다음 100행 → done이 true면 끝.
      const source = await wrap(dbSource(db, id, text(body.sourceId, "소스", 200)));
      const key = await getTenantApiKeyByTenantId(tenantId);
      let state: ImportState;
      if (!body.state) {
        state = await wrap(beginImport(source));
        await wrap(Promise.resolve(auditSync(actor, b.customer_id, source.id)));
      } else state = importState(body.state);
      state = await wrap(importStep(source, state, key));
      return Response.json({ state, source: (await listDbSources(db, id)).find((s) => s.id === source.id) ?? null });
    }
    throw new OperationError("요청을 확인해주세요.");
  } catch (e) {
    return failure(e);
  }
}

function importState(value: unknown): ImportState {
  const v = (value ?? {}) as Record<string, unknown>;
  const n = (k: string) => (Number.isFinite(Number(v[k])) ? Number(v[k]) : 0);
  return {
    cursor: v.cursor ?? null,
    processed: n("processed"),
    total: n("total"),
    truncated: n("truncated"),
    created: n("created"),
    updated: n("updated"),
    unchanged: n("unchanged"),
    failed: n("failed"),
    archived: n("archived"),
    deleted: n("deleted"),
    done: v.done === true,
  };
}
async function auditSync(actor: { userId: string | null; tenantId: string }, customerId: string | null, sourceId: string) {
  const { audit } = await import("./store");
  await audit(db, actor, customerId, "db_source.sync", sourceId);
}

/** 답변 미리보기: 질문마다 가장 가까운 문서를 고르고, OpenAI 키가 있으면 그 문서만 근거로 짧게 답한다. */
async function answerPreview(tenantId: string, documents: { title: string; content: string }[], questions: string[]) {
  const key = await getTenantApiKeyByTenantId(tenantId);
  const vectors = await getEmbeddings([...documents.map((d) => d.content.slice(0, 8000)), ...questions], key).catch(() => null);
  if (!vectors) return questions.map((question) => ({ question, title: null, answer: null, note: "임베딩을 만들지 못했어요. OpenAI API 키를 확인해주세요." }));
  const docVectors = vectors.slice(0, documents.length);
  const out: { question: string; title: string | null; answer: string | null; note: string | null }[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = vectors[documents.length + i];
    let best = -1,
      bestScore = -1;
    docVectors.forEach((v, j) => {
      const s = cosineSimilarity(q, v);
      if (s > bestScore) {
        bestScore = s;
        best = j;
      }
    });
    const doc = best >= 0 ? documents[best] : null;
    let answer: string | null = null,
      note: string | null = null;
    if (!doc) note = "근거가 될 문서가 없어요.";
    else if (!key) note = "OpenAI API 키가 없어 근거 문서만 표시해요.";
    else {
      try {
        const openai = new OpenAI({ apiKey: key });
        const completion = await openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            temperature: 0,
            messages: [
              { role: "system", content: "아래 문서만 근거로 한국어로 두 문장 이내로 답하세요. 문서에 없는 내용은 '문서에 없는 정보예요'라고 답하세요." },
              { role: "user", content: `문서:\n${doc.content}\n\n질문: ${questions[i]}` },
            ],
          },
          { signal: AbortSignal.timeout(20000) },
        );
        answer = completion.choices[0].message.content?.trim() ?? null;
      } catch {
        note = "답변 생성에 실패했어요. 근거 문서만 표시해요.";
      }
    }
    out.push({ question: questions[i], title: doc?.title ?? null, answer, note });
  }
  return out;
}
