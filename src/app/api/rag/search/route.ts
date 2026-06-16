import { NextRequest, NextResponse } from "next/server";
import { createEmbedding } from "@/lib/rag/embeddings";
import { searchSimilarChunks } from "@/lib/rag/vectorStore";
import { getSetting } from "@/lib/db/settings";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";

const MAX_TOP_K = 20;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  try {
    const { query: searchQuery, topK = 5 } = await req.json();
    if (!searchQuery?.trim()) return NextResponse.json({ error: "Query required" }, { status: 400 });

    const safeTopK = Math.min(Math.max(1, parseInt(topK) || 5), MAX_TOP_K);

    const apiKey = await getSetting("openai_api_key");
    if (!apiKey) return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 503 });

    const embedding = await createEmbedding(searchQuery, apiKey);
    const results = await searchSimilarChunks(embedding, safeTopK);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
