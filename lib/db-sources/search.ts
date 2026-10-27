import sql from "@/lib/neon";
import { cosineSimilarity } from "@/lib/embeddings";
import { parseNumericIntent, passesNumericIntent, type NumericField } from "./numeric";

export const DOC_THRESHOLD = 0.25;
export const DOC_TOP_K = 5;
/** 방문자에게 보이는 출처. 행 제목만 담는다 — 연결 이름·테이블 이름·원본 값·접속 정보는 내보내지 않는다. */
export type DocSource = { kind: "db"; label: string };
export type FoundDoc = { id: string; title: string; content: string; score: number; source: DocSource | null };
type Db = typeof sql;
type Indexed = { id: string; title: string; vector: number[]; numeric: NumericField[] | null };

/**
 * 봇별 임베딩 캐시. 매 질문마다 모든 문서의 임베딩 JSON을 다시 파싱하지 않도록 짧게(60초) 들고 있는다.
 * 문서 수·최신 생성 시각·보관 수가 바뀌면 즉시 다시 읽는다(수정은 최대 60초 늦게 반영).
 */
const CACHE_TTL_MS = 60_000,
  CACHE_BOTS = 30;
const cache = new Map<string, { at: number; stamp: string; docs: Indexed[] }>();
async function indexFor(botId: string, db: Db): Promise<Indexed[]> {
  const [meta] = await db`SELECT count(*)::int AS n, COALESCE(max(created_at),0)::bigint AS m, count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS a FROM documents WHERE bot_id=${botId}`;
  const stamp = `${meta?.n}:${meta?.m}:${meta?.a}`;
  const hit = db === sql ? cache.get(botId) : undefined;
  if (hit && hit.stamp === stamp && Date.now() - hit.at < CACHE_TTL_MS) return hit.docs;
  const rows = await db`SELECT id, title, embedding, numeric_fields FROM documents WHERE bot_id=${botId} AND embedding IS NOT NULL AND archived_at IS NULL`;
  const docs = rows.map((r) => ({ id: String(r.id), title: String(r.title), vector: JSON.parse(String(r.embedding)) as number[], numeric: (r.numeric_fields as NumericField[] | null) ?? null }));
  if (db === sql) {
    cache.delete(botId);
    cache.set(botId, { at: Date.now(), stamp, docs });
    while (cache.size > CACHE_BOTS) cache.delete(cache.keys().next().value as string);
  }
  return docs;
}

/** 채팅 응답에 싣는 출처 목록(DB에서 온 문서만, 중복 제거). */
export function sourcesOf(docs: FoundDoc[]): DocSource[] {
  const seen = new Set<string>();
  return docs.flatMap((d) => (d.source && !seen.has(d.source.label) && seen.add(d.source.label) ? [d.source] : []));
}

/**
 * 챗봇 답변용 문서 검색. 보관 문서는 빼고, 질문에 숫자 조건("2만원 이하")이 있으면 숫자 필드로 먼저 거른 뒤 임베딩 순위를 매긴다.
 */
export async function searchDocuments(botId: string, queryEmbedding: number[], message: string, db: Db = sql): Promise<FoundDoc[]> {
  const intents = parseNumericIntent(message);
  const docs = await indexFor(botId, db);
  const scored = docs
    .filter((d) => passesNumericIntent(d.numeric, intents))
    .map((d) => ({ id: d.id, title: d.title, score: cosineSimilarity(queryEmbedding, d.vector) }))
    .filter((r) => r.score >= DOC_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, DOC_TOP_K);
  if (!scored.length) return [];
  const ids = scored.map((r) => r.id);
  const content = await db`SELECT d.id, d.content, d.source_kind FROM documents d WHERE d.id = ANY(${ids}::text[])`;
  const byId = new Map(content.map((r) => [String(r.id), r]));
  return scored.map((r) => {
    const row = byId.get(r.id);
    return { ...r, content: String(row?.content ?? ""), source: row?.source_kind === "db" ? { kind: "db" as const, label: r.title } : null };
  });
}
