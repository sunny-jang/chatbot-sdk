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
/** 한 번에 새로 만들 조각 수 상한. 넘는 문서는 다음 차례에 이어서 만들고, 그동안은 문서 임베딩으로 검색합니다. */
const MAX_CHUNKS_PER_PASS = 400;
/** OpenAI 임베딩 요청 한 번에 보낼 입력 수 */
const EMBED_BATCH = 96;

export const CHUNK_THRESHOLD = 0.3;
export const DOC_FALLBACK_THRESHOLD = 0.25;
export const CHUNK_TOP_K = 8;
/** 질문의 드문 낱말이 조각에 그대로 있으면 더하는 점수 상한. 이름·제품명처럼 의미 검색이 놓치는 질문을 잡습니다. */
const KEYWORD_BONUS_MAX = 0.25;
const KEYWORD_BONUS_WEIGHT = 0.2;

const STOPWORDS = new Set([
  "누구", "누구야", "누구예요", "누구냐", "누구냐고", "뭐야", "뭐예요", "뭔가요", "무엇", "무엇인가요", "어떤", "어떻게", "어디", "어디서",
  "얼마", "얼마나", "언제", "알려줘", "알려주세요", "알려", "궁금", "궁금해요", "있어", "있나요", "있어요", "없어", "없나요", "대해", "대해서",
  "관련", "정보", "해줘", "해주세요", "주세요", "그럼", "그리고", "혹시", "이거", "저거", "그거", "여기", "거기", "있는", "하는", "되나요", "가능", "가능한가요",
]);
/** 낱말 끝에 붙는 조사·어미. 떼어 낸 형태도 후보로 함께 찾습니다. */
const SUFFIXES = ["에서는", "에서", "으로", "이라는", "라는", "이란", "이야", "이에요", "예요", "에게", "한테", "까지", "부터", "처럼", "보다", "은", "는", "이", "가", "을", "를", "에", "의", "도", "와", "과", "야", "요"];

/** 질문에서 찾을 낱말을 뽑습니다. 낱말마다 원형과 조사를 뗀 형태를 후보로 둡니다. */
export function queryTerms(query: string): string[][] {
  const seen = new Set<string>();
  const terms: string[][] = [];
  for (const raw of query.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? []) {
    if (STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    const variants = new Set([raw]);
    for (const suffix of SUFFIXES) {
      if (raw.length - suffix.length >= 2 && raw.endsWith(suffix)) variants.add(raw.slice(0, -suffix.length));
    }
    const kept = [...variants].filter((v) => !STOPWORDS.has(v));
    if (kept.length) terms.push(kept);
  }
  return terms.slice(0, 12);
}

/**
 * 낱말 점수: 그 낱말이 들어 있는 조각이 적을수록(드문 낱말일수록) 크게 줍니다.
 * idf = 1 - (낱말이 든 조각 수 / 전체 조각 수), 점수 = 가중치 × Σ idf² (상한 있음). 흔한 낱말은 제곱으로 거의 0이 됩니다.
 */
export function keywordBonus(matchedTermIdfs: number[]) {
  const sum = matchedTermIdfs.reduce((acc, idf) => acc + idf * idf, 0);
  return Math.min(KEYWORD_BONUS_MAX, KEYWORD_BONUS_WEIGHT * sum);
}

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
  // 문서 여러 개의 조각을 모아 한 번에 임베딩해 요청 수를 줄입니다.
  const planned: { id: string; hash: string; pieces: string[]; offset: number }[] = [];
  const inputs: string[] = [];
  for (const doc of stale) {
    const pieces = chunkText(doc.content as string);
    if (pieces.length === 0) continue;
    if (inputs.length + pieces.length > MAX_CHUNKS_PER_PASS) break;
    planned.push({ id: doc.id as string, hash: doc.hash as string, pieces, offset: inputs.length });
    inputs.push(...pieces.map((p) => `${doc.title}\n${p}`));
  }

  const vectors: (number[] | undefined)[] = new Array(inputs.length);
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    try {
      const batch = await embedFn(inputs.slice(i, i + EMBED_BATCH));
      batch.forEach((v, j) => { vectors[i + j] = v; });
    } catch (error) {
      console.error("[chunks] 조각 임베딩 실패", botId, error instanceof Error ? error.message : error);
    }
  }

  let updated = 0;
  for (const doc of planned) {
    const docVectors = vectors.slice(doc.offset, doc.offset + doc.pieces.length);
    if (docVectors.some((v) => !v?.length || v.some((x) => !Number.isFinite(x)))) continue;
    try {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM document_chunks WHERE document_id = ${doc.id}`;
        for (let i = 0; i < doc.pieces.length; i++) {
          await tx`
            INSERT INTO document_chunks (document_id, chunk_index, bot_id, content_hash, content, embedding)
            VALUES (${doc.id}, ${i}, ${botId}, ${doc.hash}, ${doc.pieces[i]}, ${JSON.stringify(docVectors[i])})
            ON CONFLICT (document_id, chunk_index) DO UPDATE
              SET content_hash = EXCLUDED.content_hash, content = EXCLUDED.content, embedding = EXCLUDED.embedding
          `;
        }
      });
      updated += 1;
    } catch (error) {
      console.error("[chunks] 문서 조각 저장 실패", doc.id, error instanceof Error ? error.message : error);
    }
  }
  return { updated, pending: stale.length - updated };
}

export type RetrievedDoc = { title: string; content: string; score: number };

type Hit = { docId: string; index: number; score: number };

/** 조각별 낱말 점수를 계산하는 함수를 만듭니다. 한 낱말의 후보 중 가장 드문 형태 하나만 셉니다. */
export function keywordScorer(
  terms: string[][],
  rows: { term: string; document_id: string; chunk_index: number }[],
  totalChunks: number,
) {
  if (!terms.length || !rows.length || totalChunks === 0) return () => 0;
  const chunksByVariant = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.document_id}:${r.chunk_index}`;
    const set = chunksByVariant.get(r.term) ?? new Set<string>();
    set.add(key);
    chunksByVariant.set(r.term, set);
  }
  const idfOf = (variant: string) => 1 - (chunksByVariant.get(variant)?.size ?? 0) / totalChunks;
  const cache = new Map<string, number>();
  return (chunkKey: string) => {
    const hit = cache.get(chunkKey);
    if (hit !== undefined) return hit;
    const idfs: number[] = [];
    for (const term of terms) {
      const matched = term.filter((v) => chunksByVariant.get(v)?.has(chunkKey)).map(idfOf);
      if (matched.length) idfs.push(Math.max(...matched));
    }
    const bonus = keywordBonus(idfs);
    cache.set(chunkKey, bonus);
    return bonus;
  };
}

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
export async function findRelevantChunks(botId: string, queryEmbedding: number[], query = ""): Promise<RetrievedDoc[]> {
  await ensureChunkSchema();
  const terms = queryTerms(query);
  const variants = [...new Set(terms.flat())];
  const [chunkRows, docRows, keywordRows] = await Promise.all([
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
    // 낱말 후보마다 그 낱말이 들어 있는 최신 조각을 찾습니다.
    variants.length
      ? sql`
          SELECT v.term, c.document_id, c.chunk_index
          FROM unnest(${variants}::text[]) AS v(term)
          JOIN document_chunks c ON c.bot_id = ${botId} AND strpos(lower(c.content), v.term) > 0
          JOIN documents d ON d.id = c.document_id AND c.content_hash = d.content_md5
        `
      : Promise.resolve([]),
  ]);

  const titles = new Map(docRows.map((r) => [r.id as string, r.title as string]));
  const bonusOf = keywordScorer(terms, keywordRows as unknown as { term: string; document_id: string; chunk_index: number }[], chunkRows.length);
  const hits: Hit[] = chunkRows
    .map((r) => ({
      docId: r.document_id as string,
      index: r.chunk_index as number,
      score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding as string)),
    }))
    .map((h) => ({ ...h, score: h.score + bonusOf(`${h.docId}:${h.index}`) }))
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

/**
 * 응답을 보낸 다음에 조각을 만듭니다. 문서 저장 직후와 채팅마다 부르며, 바뀐 문서가 없으면 조회 한 번으로 끝납니다.
 * 조각이 준비되기 전 질문은 기존 문서 임베딩으로 검색되므로 답변이 늦어지지 않습니다.
 */
export function warmChunksAfterResponse(botId: string, apiKey: string | null | undefined) {
  if (!apiKey) return;
  after(() => syncBotChunks(botId, apiKey).catch(() => undefined));
}
