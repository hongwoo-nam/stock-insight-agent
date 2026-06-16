import OpenAI from "openai";
import { logUsage } from "@/lib/db/usage";

let client: OpenAI | null = null;

function getClient(apiKey?: string): OpenAI {
  if (!client || apiKey) {
    client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function createEmbedding(
  text: string,
  apiKey?: string
): Promise<number[]> {
  const openai = getClient(apiKey);
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  const tokens = response.usage?.total_tokens ?? 0;
  void logUsage("embedding", "text-embedding-3-small", tokens, 0);
  return response.data[0].embedding;
}

export async function createEmbeddingsBatch(
  texts: string[],
  apiKey?: string
): Promise<number[][]> {
  const openai = getClient(apiKey);
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}
