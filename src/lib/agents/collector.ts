import { getSupabase } from "@/lib/db/client";
import {
  fetchChannelVideos,
  fetchTranscript,
  chunkTranscript,
  saveVideo,
  updateVideoStatus,
  getNewVideoIds,
  type TranscriptSegment,
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

  const result: CollectionResult = { new_videos: 0, processed: 0, failed: 0, errors: [] };

  const supabase = getSupabase();
  const { data: logRow } = await supabase
    .from("collection_logs")
    .insert({ job_date: new Date().toISOString().split("T")[0], status: "running", new_video_count: 0 })
    .select("id")
    .single();
  const logId = logRow?.id;

  try {
    const videos = await fetchChannelVideos(youtubeKey);
    const newIds = await getNewVideoIds(videos.map((v) => v.video_id));
    const newVideos = videos.filter((v) => newIds.includes(v.video_id));
    result.new_videos = newVideos.length;

    // Also retry previously failed no_transcript videos
    const { data: retryVideos } = await supabase
      .from("videos")
      .select("video_id, title, url, published_at, duration")
      .eq("transcript_status", "no_transcript")
      .limit(20);

    for (const v of retryVideos || []) {
      if (!newVideos.find((nv) => nv.video_id === v.video_id)) {
        newVideos.push({ video_id: v.video_id, title: v.title, url: v.url, published_at: v.published_at, duration: v.duration });
      }
    }

    for (const video of newVideos) {
      try {
        await saveVideo(video);
        await updateVideoStatus(video.video_id, "processing");

        let segments;
        try {
          segments = await fetchTranscript(video.video_id);
        } catch (transcriptErr) {
          const msg = transcriptErr instanceof Error ? transcriptErr.message : String(transcriptErr);
          // Skip videos with no transcript — not a failure
          if (msg.includes("disabled") || msg.includes("Transcript") || msg.includes("No transcript")) {
            await updateVideoStatus(video.video_id, "no_transcript");
            continue;
          }
          throw transcriptErr;
        }

        if (!segments.length) {
          await updateVideoStatus(video.video_id, "no_transcript");
          continue;
        }

        const chunks = chunkTranscript(segments);
        const embeddings = await createEmbeddingsBatch(chunks.map((c) => c.text), openaiKey);
        await saveChunks(video.video_id, chunks.map((c, i) => ({ ...c, embedding: embeddings[i], index: i })));
        await updateVideoStatus(video.video_id, "done");
        result.processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${video.video_id}: ${msg}`);
        result.failed++;
        await updateVideoStatus(video.video_id, "failed").catch(() => {});
      }
    }

    if (logId) {
      await supabase
        .from("collection_logs")
        .update({ status: "completed", new_video_count: result.processed })
        .eq("id", logId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logId) {
      await supabase
        .from("collection_logs")
        .update({ status: "failed", error_message: msg })
        .eq("id", logId);
    }
    throw err;
  }

  return result;
}
