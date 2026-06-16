import { YoutubeTranscript } from "youtube-transcript";
import { getSupabase } from "@/lib/db/client";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export interface VideoInfo {
  video_id: string;
  title: string;
  url: string;
  published_at: string;
  duration: number;
}

export async function fetchChannelVideos(
  apiKey: string,
  maxResults = 50
): Promise<VideoInfo[]> {
  // Try @handle format first, then without @
  let channelData;
  for (const handle of ["@syukaworld", "syukaworld"]) {
    const res = await fetch(
      `${YOUTUBE_API_BASE}/channels?part=id,contentDetails&forHandle=${handle}&key=${apiKey}`
    );
    channelData = await res.json();
    if (channelData.items?.length) break;
  }

  // Fallback: search by channel name
  if (!channelData?.items?.length) {
    const searchRes = await fetch(
      `${YOUTUBE_API_BASE}/search?part=snippet&type=channel&q=슈카월드&maxResults=1&key=${apiKey}`
    );
    const searchData = await searchRes.json();
    if (searchData.items?.length) {
      const channelId = searchData.items[0].snippet.channelId;
      const res = await fetch(
        `${YOUTUBE_API_BASE}/channels?part=id,contentDetails&id=${channelId}&key=${apiKey}`
      );
      channelData = await res.json();
    }
  }

  if (!channelData?.items?.length) throw new Error(`Channel not found. API response: ${JSON.stringify(channelData)}`);

  const uploadsPlaylistId =
    channelData.items[0].contentDetails.relatedPlaylists.uploads;

  const playlistRes = await fetch(
    `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}&key=${apiKey}`
  );
  const playlistData = await playlistRes.json();

  const videoIds = playlistData.items.map(
    (item: { snippet: { resourceId: { videoId: string } } }) =>
      item.snippet.resourceId.videoId
  );

  const detailsRes = await fetch(
    `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails&id=${videoIds.join(",")}&key=${apiKey}`
  );
  const detailsData = await detailsRes.json();

  return detailsData.items.map(
    (item: {
      id: string;
      snippet: { title: string; publishedAt: string };
      contentDetails: { duration: string };
    }) => ({
      video_id: item.id,
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      published_at: item.snippet.publishedAt,
      duration: parseISO8601Duration(item.contentDetails.duration),
    })
  );
}

function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    parseInt(match[1] || "0") * 3600 +
    parseInt(match[2] || "0") * 60 +
    parseInt(match[3] || "0")
  );
}

export async function getNewVideoIds(videoIds: string[]): Promise<string[]> {
  if (!videoIds.length) return [];
  const supabase = getSupabase();
  const { data } = await supabase
    .from("videos")
    .select("video_id")
    .in("video_id", videoIds);
  const existingSet = new Set((data || []).map((r: { video_id: string }) => r.video_id));
  return videoIds.filter((id) => !existingSet.has(id));
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: "ko" }).catch(() =>
    YoutubeTranscript.fetchTranscript(videoId)
  );
  return transcript.map((item) => ({
    text: item.text,
    offset: item.offset / 1000,
    duration: item.duration / 1000,
  }));
}

export function chunkTranscript(
  segments: TranscriptSegment[],
  chunkTokens = 1000,
  overlapTokens = 150
): Array<{ text: string; start_time: number; end_time: number }> {
  const chunks: Array<{ text: string; start_time: number; end_time: number }> = [];
  const estimateTokens = (text: string) => Math.ceil(text.length / 2);

  let currentChunk: TranscriptSegment[] = [];
  let currentTokens = 0;

  for (const seg of segments) {
    const tokens = estimateTokens(seg.text);
    currentChunk.push(seg);
    currentTokens += tokens;

    if (currentTokens >= chunkTokens) {
      chunks.push({
        text: currentChunk.map((s) => s.text).join(" "),
        start_time: currentChunk[0].offset,
        end_time: currentChunk[currentChunk.length - 1].offset + currentChunk[currentChunk.length - 1].duration,
      });

      const overlapSegs: TranscriptSegment[] = [];
      let overlapCount = 0;
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        overlapCount += estimateTokens(currentChunk[i].text);
        overlapSegs.unshift(currentChunk[i]);
        if (overlapCount >= overlapTokens) break;
      }
      currentChunk = overlapSegs;
      currentTokens = overlapSegs.reduce((sum, s) => sum + estimateTokens(s.text), 0);
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.map((s) => s.text).join(" "),
      start_time: currentChunk[0].offset,
      end_time: currentChunk[currentChunk.length - 1].offset + currentChunk[currentChunk.length - 1].duration,
    });
  }

  return chunks;
}

export async function saveVideo(video: VideoInfo): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("videos").upsert(
    {
      video_id: video.video_id,
      title: video.title,
      url: video.url,
      published_at: video.published_at,
      duration: video.duration,
      transcript_status: "pending",
    },
    { onConflict: "video_id", ignoreDuplicates: true }
  );
}

export async function updateVideoStatus(
  videoId: string,
  status: string
): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("videos")
    .update({ transcript_status: status })
    .eq("video_id", videoId);
}
