import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
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
  threshold = 0.75
): Promise<{ answer: string; score: number } | null> {
  const queryEmbedding = await getEmbedding(query);

  let best: { answer: string; score: number } | null = null;

  for (const pair of pairs) {
    if (!pair.embedding) continue;
    const pairEmbedding: number[] = JSON.parse(pair.embedding);
    const score = cosineSimilarity(queryEmbedding, pairEmbedding);
    if (score >= threshold && (!best || score > best.score)) {
      best = { answer: pair.answer, score };
    }
  }

  return best;
}
