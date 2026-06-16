import { query } from "@/lib/db/client";
import {
  fetchChannelVideos,
  fetchTranscript,
  chunkTranscript,
  saveVideo,
  updateVideoStatus,
  getNewVideoIds,
} from "@/lib/youtube/collector";
import { createEmbeddingsBatch } from "@/lib/rag/embeddings";
import { saveChunks } from "@/lib/rag/vectorStore";
import { getSetting } from "@/lib/db/settings";

export interface CollectionResult {
  new_videos: number;
  processed: number;
  failed: number;
  errors: string[];
}

export async function runCollector(): Promise<CollectionResult> {
  const openaiKey = await getSetting("openai_api_key");
  const youtubeKey = await getSetting("youtube_api_key");

  if (!openaiKey || !youtubeKey) {
    throw new Error("API keys not configured");
  }

  const result: CollectionResult = {
    new_videos: 0,
    processed: 0,
    failed: 0,
    errors: [],
  };

  // Log start
  const [logRow] = await query<{ id: number }>(
    `INSERT INTO collection_logs (job_date, status, new_video_count)
     VALUES (CURRENT_DATE, 'running', 0)
     RETURNING id`
  );
  const logId = logRow.id;

  try {
    const videos = await fetchChannelVideos(youtubeKey);
    const videoIds = videos.map((v) => v.video_id);
    const newIds = await getNewVideoIds(videoIds);
    const newVideos = videos.filter((v) => newIds.includes(v.video_id));

    result.new_videos = newVideos.length;

    for (const video of newVideos) {
      try {
        await saveVideo(video);
        await updateVideoStatus(video.video_id, "processing");

        const segments = await fetchTranscript(video.video_id);
        const chunks = chunkTranscript(segments);

        const texts = chunks.map((c) => c.text);
        const embeddings = await createEmbeddingsBatch(texts, openaiKey);

        await saveChunks(
          video.video_id,
          chunks.map((c, i) => ({
            ...c,
            embedding: embeddings[i],
            index: i,
          }))
        );

        await updateVideoStatus(video.video_id, "done");
        result.processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${video.video_id}: ${msg}`);
        result.failed++;
        await updateVideoStatus(video.video_id, "failed").catch(() => {});
      }
    }

    await query(
      `UPDATE collection_logs SET status = 'completed', new_video_count = $1 WHERE id = $2`,
      [result.processed, logId]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE collection_logs SET status = 'failed', error_message = $1 WHERE id = $2`,
      [msg, logId]
    );
    throw err;
  }

  return result;
}
