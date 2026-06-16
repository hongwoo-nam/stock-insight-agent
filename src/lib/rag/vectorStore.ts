import { query } from "@/lib/db/client";
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
  for (const chunk of chunks) {
    const embeddingStr = `[${chunk.embedding.join(",")}]`;
    await query(
      `INSERT INTO transcript_chunks (video_id, chunk_index, chunk_text, start_time, end_time, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       ON CONFLICT (video_id, chunk_index) DO UPDATE
       SET chunk_text = $3, start_time = $4, end_time = $5, embedding = $6::vector`,
      [videoId, chunk.index, chunk.text, chunk.start_time, chunk.end_time, embeddingStr]
    );
  }
}

export async function searchSimilarChunks(
  embedding: number[],
  topK = 5
): Promise<(Source & { video_title: string; video_url: string })[]> {
  const embeddingStr = `[${embedding.join(",")}]`;
  const rows = await query<{
    video_id: string;
    chunk_text: string;
    start_time: number;
    title: string;
    url: string;
    similarity: number;
  }>(
    `SELECT
       tc.video_id,
       tc.chunk_text,
       tc.start_time,
       v.title,
       v.url,
       1 - (tc.embedding <=> $1::vector) AS similarity
     FROM transcript_chunks tc
     JOIN videos v ON v.video_id = tc.video_id
     ORDER BY tc.embedding <=> $1::vector
     LIMIT $2`,
    [embeddingStr, topK]
  );

  return rows.map((r) => ({
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
