import OpenAI from "openai";
import { createHash } from "node:crypto";

function getClient(apiKey?: string | null) {
  return new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
}

/**
 * 로컬 QA 전용 결정적 임베딩. EMBEDDINGS_FAKE=1이고 POSTGRES_URL이 로컬일 때만 켜진다.
 * 문자 2-gram을 해시해 256차원에 누적하므로 같은 단어가 겹치는 문장끼리 유사도가 높다(검색 흐름 검증용, 품질 검증 아님).
 */
export function fakeEmbeddingsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.EMBEDDINGS_FAKE !== "1") return false;
  try {
    const host = new URL(env.POSTGRES_URL || "").hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}
export function fakeEmbedding(text: string, dims = 256): number[] {
  const v = new Array<number>(dims).fill(0);
  const s = text.toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < s.length - 1; i++) {
    const h = createHash("md5").update(s.slice(i, i + 2)).digest();
    v[h.readUInt16BE(0) % dims] += 1;
    v[h.readUInt16BE(2) % dims] += 0.5;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

export async function getEmbedding(
  text: string,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<number[]> {
  if (fakeEmbeddingsEnabled()) return fakeEmbedding(text);
  const response = await getClient(apiKey).embeddings.create(
    {
      model: "text-embedding-3-small",
      input: text,
    },
    { signal },
  );
  return response.data[0].embedding;
}

export async function getEmbeddings(
  texts: string[],
  apiKey?: string | null,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (fakeEmbeddingsEnabled()) return texts.map((t) => fakeEmbedding(t));
  const response = await getClient(apiKey).embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function findBestMatch(
  query: string,
  pairs: { id: string; answer: string; embedding: string | null }[],
  threshold = 0.75,
  apiKey?: string | null,
): Promise<{ id: string; answer: string; score: number } | null> {
  const queryEmbedding = await getEmbedding(query, apiKey);

  let best: { id: string; answer: string; score: number } | null = null;

  for (const pair of pairs) {
    if (!pair.embedding) continue;
    const pairEmbedding: number[] = JSON.parse(pair.embedding);
    const score = cosineSimilarity(queryEmbedding, pairEmbedding);
    if (score >= threshold && (!best || score > best.score)) {
      best = { id: pair.id, answer: pair.answer, score };
    }
  }

  return best;
}
