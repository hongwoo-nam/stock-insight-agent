import { NextRequest, NextResponse } from "next/server";
import { createEmbedding } from "@/lib/rag/embeddings";
import { searchSimilarChunks } from "@/lib/rag/vectorStore";
import { getSetting } from "@/lib/db/settings";

export async function POST(req: NextRequest) {
  try {
    const { query: searchQuery, topK = 5 } = await req.json();
    if (!searchQuery?.trim()) {
      return NextResponse.json({ error: "Query required" }, { status: 400 });
    }

    const apiKey = await getSetting("openai_api_key");
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 503 });
    }

    const embedding = await createEmbedding(searchQuery, apiKey);
    const results = await searchSimilarChunks(embedding, topK);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("RAG search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
