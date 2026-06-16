import { getSupabase } from "@/lib/db/client";
import { Source } from "@/types";

export async function saveChunks(
  videoId: string,
  chunks: Array<{
    text: string;
    start_time: number;
    end_time: number;
    embedding: number[];
    index: number;
  }>
): Promise<void> {
  const supabase = getSupabase();
  const rows = chunks.map((c) => ({
    video_id: videoId,
    chunk_index: c.index,
    chunk_text: c.text,
    start_time: c.start_time,
    end_time: c.end_time,
    embedding: JSON.stringify(c.embedding),
  }));

  const { error } = await supabase
    .from("transcript_chunks")
    .upsert(rows, { onConflict: "video_id,chunk_index" });

  if (error) throw new Error(error.message);
}

export async function searchSimilarChunks(
  embedding: number[],
  topK = 5
): Promise<(Source & { video_title: string; video_url: string })[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("search_chunks", {
    query_embedding: JSON.stringify(embedding),
    match_count: topK,
  });

  if (error) throw new Error(error.message);

  return (data || []).map((r: {
    video_id: string;
    title: string;
    url: string;
    start_time: number;
    chunk_text: string;
    similarity: number;
  }) => ({
    video_id: r.video_id,
    title: r.title,
    url: r.url,
    start_time: r.start_time,
    chunk_text: r.chunk_text,
    similarity: r.similarity,
    video_title: r.title,
    video_url: r.url,
  }));
}
