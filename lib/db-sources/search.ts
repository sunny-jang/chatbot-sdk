import sql from "@/lib/neon";
import { cosineSimilarity } from "@/lib/embeddings";
import { parseNumericIntent, passesNumericIntent, type NumericField } from "./numeric";

export const DOC_THRESHOLD = 0.25;
export const DOC_TOP_K = 5;
export type DocSource = { kind: "db"; label: string; connection: string; table: string; title: string };
export type FoundDoc = { id: string; title: string; content: string; score: number; source: DocSource | null };
type Db = typeof sql;

/**
 * 챗봇 답변용 문서 검색. 보관 문서는 빼고, 질문에 숫자 조건("2만원 이하")이 있으면 숫자 필드로 먼저 거른 뒤 임베딩 순위를 매긴다.
 * DB에서 온 문서는 출처(연결 이름·테이블·행 제목)를 함께 돌려준다. 접속 정보·원본 값은 담지 않는다.
 */
export async function searchDocuments(botId: string, queryEmbedding: number[], message: string, db: Db = sql): Promise<FoundDoc[]> {
  const intents = parseNumericIntent(message);
  const rows = await db`SELECT id, title, embedding, numeric_fields FROM documents WHERE bot_id=${botId} AND embedding IS NOT NULL AND archived_at IS NULL`;
  const scored = rows
    .filter((r) => passesNumericIntent(r.numeric_fields as NumericField[] | null, intents))
    .map((r) => ({ id: String(r.id), title: String(r.title), score: cosineSimilarity(queryEmbedding, JSON.parse(String(r.embedding))) }))
    .filter((r) => r.score >= DOC_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, DOC_TOP_K);
  if (!scored.length) return [];
  const ids = scored.map((r) => r.id);
  const content = await db`SELECT d.id, d.content, c.name AS connection, s.schema_name, s.table_name
    FROM documents d
    LEFT JOIN db_source_rows r ON r.document_id=d.id
    LEFT JOIN db_sources s ON s.id=r.source_id
    LEFT JOIN data_connections c ON c.id=s.connection_id
    WHERE d.id = ANY(${ids}::text[])`;
  const byId = new Map(content.map((r) => [String(r.id), r]));
  return scored.map((r) => {
    const row = byId.get(r.id);
    const table = row?.table_name ? (row.schema_name === "public" ? String(row.table_name) : `${row.schema_name}.${row.table_name}`) : null;
    const source: DocSource | null = table
      ? { kind: "db", connection: String(row?.connection ?? ""), table, title: r.title, label: [row?.connection, table, r.title].filter(Boolean).join(" · ") }
      : null;
    return { ...r, content: String(row?.content ?? ""), source };
  });
}
