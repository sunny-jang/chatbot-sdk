import { after } from "next/server";
import sql from "@/lib/neon";
import { cosineSimilarity, getEmbeddings } from "@/lib/embeddings";

/**
 * 문서 하나를 임베딩 하나로 만들면 긴 문서 속 짧은 정보는 질문과 유사도가 낮아져 검색되지 않습니다.
 * 문서를 1천 자 안팎 조각으로 나눠 조각마다 임베딩하고, 답변에는 질문과 가까운 조각만 넣습니다.
 *
 * 조각은 문서의 제목·본문 해시(documents.content_md5)가 바뀌면 다시 만듭니다. 문서를 저장하는 경로가 여러 곳이어도
 * 검색 직전에 해시를 비교하므로 오래된 조각이 쓰이지 않고, 조각이 없는 문서는 기존 문서 임베딩으로 검색합니다.
 */

export const CHUNK_TARGET_CHARS = 900;
export const CHUNK_OVERLAP_CHARS = 150;
const CHUNK_MIN_TAIL_CHARS = 200;
/** 한 번에 새로 만들 조각 수 상한. 넘는 문서는 다음 요청에서 이어서 만들고, 그동안은 문서 임베딩으로 검색합니다. */
const MAX_CHUNKS_PER_PASS = 400;
/** OpenAI 임베딩 요청 한 번에 보낼 입력 수 */
const EMBED_BATCH = 96;

export const CHUNK_THRESHOLD = 0.3;
export const DOC_FALLBACK_THRESHOLD = 0.25;
export const CHUNK_TOP_K = 8;

let schemaReady: Promise<void> | null = null;

export function ensureChunkSchema() {
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS document_chunks (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        bot_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        PRIMARY KEY (document_id, chunk_index)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS document_chunks_bot_idx ON document_chunks(bot_id)`;
    // 매 질문마다 본문 전체를 해시하지 않도록 저장할 때 한 번 계산해 둡니다.
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_md5 TEXT GENERATED ALWAYS AS (md5(title || E'\n' || content)) STORED`;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

/** 문단 → 줄 → 문장 → 공백 순으로 자연스러운 경계를 찾아 자릅니다. */
function findCut(text: string, start: number, end: number) {
  const window = text.slice(start, end);
  const minCut = Math.floor(window.length * 0.5);
  for (const pattern of [/\n\s*\n/g, /\n/g, /[.!?。]\s/g, /\s/g]) {
    let cut = -1;
    for (const m of window.matchAll(pattern)) {
      const at = (m.index ?? 0) + m[0].length;
      if (at >= minCut) cut = at;
    }
    if (cut > 0) return start + cut;
  }
  return end;
}

export function chunkText(
  input: string,
  target = CHUNK_TARGET_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): string[] {
  const text = input.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return [];
  if (text.length <= target + CHUNK_MIN_TAIL_CHARS) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= target + CHUNK_MIN_TAIL_CHARS) {
      chunks.push(text.slice(start).trim());
      break;
    }
    const cut = findCut(text, start, start + target);
    chunks.push(text.slice(start, cut).trim());
    // 다음 조각은 앞 조각 끝부분을 조금 겹쳐 시작해 경계에 걸친 문장도 찾을 수 있게 합니다.
    let next = Math.max(cut - overlap, start + 1);
    const space = text.slice(next, cut).search(/\s/);
    if (space >= 0) next += space + 1;
    start = next;
  }
  return chunks.filter(Boolean);
}

type Embedder = (texts: string[]) => Promise<number[][]>;

/**
 * 조각이 없거나 문서가 바뀐 경우에만 조각을 새로 만듭니다.
 * 실패해도 예외를 던지지 않습니다. 그 문서는 기존 문서 임베딩으로 검색됩니다.
 */
export async function syncBotChunks(botId: string, apiKey: string | null | undefined, embed?: Embedder) {
  if (!apiKey && !embed) return { updated: 0, pending: 0 };
  await ensureChunkSchema();
  const stale = await sql`
    SELECT d.id, d.title, d.content, d.content_md5 AS hash
    FROM documents d
    WHERE d.bot_id = ${botId}
      AND NOT EXISTS (
        SELECT 1 FROM document_chunks c
        WHERE c.document_id = d.id AND c.chunk_index = 0
          AND c.content_hash = d.content_md5
      )
    ORDER BY d.created_at, d.id
  `;
  if (stale.length === 0) return { updated: 0, pending: 0 };

  const embedFn: Embedder = embed ?? ((texts) => getEmbeddings(texts, apiKey));
  let budget = MAX_CHUNKS_PER_PASS;
  let updated = 0;
  for (const doc of stale) {
    const pieces = chunkText(doc.content as string);
    if (pieces.length === 0) continue;
    if (pieces.length > budget) break;
    budget -= pieces.length;
    try {
      const inputs = pieces.map((p) => `${doc.title}\n${p}`);
      const vectors: number[][] = [];
      for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
        vectors.push(...(await embedFn(inputs.slice(i, i + EMBED_BATCH))));
      }
      if (vectors.length !== pieces.length || vectors.some((v) => !v?.length || v.some((x) => !Number.isFinite(x)))) continue;
      await sql.begin(async (tx) => {
        await tx`DELETE FROM document_chunks WHERE document_id = ${doc.id as string}`;
        for (let i = 0; i < pieces.length; i++) {
          await tx`
            INSERT INTO document_chunks (document_id, chunk_index, bot_id, content_hash, content, embedding)
            VALUES (${doc.id as string}, ${i}, ${botId}, ${doc.hash as string}, ${pieces[i]}, ${JSON.stringify(vectors[i])})
            ON CONFLICT (document_id, chunk_index) DO UPDATE
              SET content_hash = EXCLUDED.content_hash, content = EXCLUDED.content, embedding = EXCLUDED.embedding
          `;
        }
      });
      updated += 1;
    } catch (error) {
      console.error("[chunks] 문서 조각 생성 실패", doc.id, error instanceof Error ? error.message : error);
    }
  }
  return { updated, pending: stale.length - updated };
}

export type RetrievedDoc = { title: string; content: string; score: number };

type Hit = { docId: string; index: number; score: number };

/** 점수 높은 순으로 고른 조각을 문서별로 묶고, 같은 문서 안에서는 원래 순서대로 잇습니다. */
export function groupHits(
  top: Hit[],
  textOf: (hit: Hit) => string | undefined,
  titleOf: (docId: string) => string,
): RetrievedDoc[] {
  const grouped = new Map<string, { score: number; parts: { index: number; text: string }[] }>();
  for (const hit of top) {
    const text = textOf(hit);
    if (!text) continue;
    const group = grouped.get(hit.docId) ?? { score: hit.score, parts: [] };
    group.score = Math.max(group.score, hit.score);
    group.parts.push({ index: hit.index, text });
    grouped.set(hit.docId, group);
  }
  return [...grouped.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([docId, group]) => ({
      title: titleOf(docId),
      score: group.score,
      content: group.parts.sort((a, b) => a.index - b.index).map((p) => p.text).join("\n…\n"),
    }));
}

/**
 * 질문과 가까운 조각을 찾아 문서별로 묶습니다.
 * 최신 조각이 없는 문서는 기존 문서 임베딩으로 점수를 매기고 본문을 그대로 씁니다.
 */
export async function findRelevantChunks(botId: string, queryEmbedding: number[]): Promise<RetrievedDoc[]> {
  await ensureChunkSchema();
  const [chunkRows, docRows] = await Promise.all([
    sql`
      SELECT c.document_id, c.chunk_index, c.embedding
      FROM document_chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.bot_id = ${botId} AND c.content_hash = d.content_md5
    `,
    sql`
      SELECT d.id, d.title, d.embedding,
        EXISTS (
          SELECT 1 FROM document_chunks c
          WHERE c.document_id = d.id AND c.chunk_index = 0 AND c.content_hash = d.content_md5
        ) AS chunked
      FROM documents d WHERE d.bot_id = ${botId}
    `,
  ]);

  const titles = new Map(docRows.map((r) => [r.id as string, r.title as string]));
  const hits: Hit[] = chunkRows
    .map((r) => ({
      docId: r.document_id as string,
      index: r.chunk_index as number,
      score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding as string)),
    }))
    .filter((h) => h.score >= CHUNK_THRESHOLD);
  const fallback: Hit[] = docRows
    .filter((r) => !r.chunked && r.embedding)
    .map((r) => ({ docId: r.id as string, index: -1, score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding as string)) }))
    .filter((h) => h.score >= DOC_FALLBACK_THRESHOLD);

  const top = [...hits, ...fallback].sort((a, b) => b.score - a.score).slice(0, CHUNK_TOP_K);
  if (top.length === 0) return [];

  const chunkKeys = top.filter((t) => t.index >= 0);
  const fallbackIds = top.filter((t) => t.index < 0).map((t) => t.docId);
  const [chunkContent, docContent] = await Promise.all([
    chunkKeys.length
      ? sql`
          SELECT c.document_id, c.chunk_index, c.content FROM document_chunks c
          JOIN unnest(${chunkKeys.map((k) => k.docId)}::text[], ${chunkKeys.map((k) => k.index)}::int[]) AS k(document_id, chunk_index)
            ON k.document_id = c.document_id AND k.chunk_index = c.chunk_index
        `
      : Promise.resolve([]),
    fallbackIds.length
      ? sql`SELECT id, content FROM documents WHERE id = ANY(${fallbackIds}::text[])`
      : Promise.resolve([]),
  ]);
  const chunkTexts = new Map(chunkContent.map((r) => [`${r.document_id}:${r.chunk_index}`, r.content as string]));
  const docTexts = new Map(docContent.map((r) => [r.id as string, r.content as string]));

  return groupHits(
    top,
    (hit) => (hit.index >= 0 ? chunkTexts.get(`${hit.docId}:${hit.index}`) : docTexts.get(hit.docId)),
    (docId) => titles.get(docId) ?? "",
  );
}

/** 문서를 저장한 뒤 응답을 보낸 다음에 조각을 미리 만들어 첫 질문이 느려지지 않게 합니다. */
export function warmChunksAfterResponse(botId: string, apiKey: string | null | undefined) {
  if (!apiKey) return;
  after(() => syncBotChunks(botId, apiKey).catch(() => undefined));
}
