import { YoutubeTranscript } from "youtube-transcript";
import { query } from "@/lib/db/client";
import { Video } from "@/types";

const CHANNEL_URL = "https://www.youtube.com/@syukaworld";
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
  // First get channel ID
  const channelRes = await fetch(
    `${YOUTUBE_API_BASE}/channels?part=id,contentDetails&forHandle=syukaworld&key=${apiKey}`
  );
  const channelData = await channelRes.json();
  if (!channelData.items?.length) throw new Error("Channel not found");

  const uploadsPlaylistId =
    channelData.items[0].contentDetails.relatedPlaylists.uploads;

  // Get playlist items
  const playlistRes = await fetch(
    `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}&key=${apiKey}`
  );
  const playlistData = await playlistRes.json();

  const videoIds = playlistData.items.map(
    (item: { snippet: { resourceId: { videoId: string } } }) =>
      item.snippet.resourceId.videoId
  );

  // Get video details
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
    (parseInt(match[1] || "0") * 3600) +
    (parseInt(match[2] || "0") * 60) +
    parseInt(match[3] || "0")
  );
}

export async function getNewVideoIds(
  videoIds: string[]
): Promise<string[]> {
  if (!videoIds.length) return [];
  const placeholders = videoIds.map((_, i) => `$${i + 1}`).join(",");
  const existing = await query<{ video_id: string }>(
    `SELECT video_id FROM videos WHERE video_id IN (${placeholders})`,
    videoIds
  );
  const existingSet = new Set(existing.map((r) => r.video_id));
  return videoIds.filter((id) => !existingSet.has(id));
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export async function fetchTranscript(
  videoId: string
): Promise<TranscriptSegment[]> {
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: "ko",
  }).catch(() =>
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
  const chunks: Array<{ text: string; start_time: number; end_time: number }> =
    [];

  // Rough token estimate: 1 token ≈ 2 Korean chars or 0.75 English words
  const estimateTokens = (text: string) => Math.ceil(text.length / 2);

  let currentChunk: TranscriptSegment[] = [];
  let currentTokens = 0;

  for (const seg of segments) {
    const tokens = estimateTokens(seg.text);
    currentChunk.push(seg);
    currentTokens += tokens;

    if (currentTokens >= chunkTokens) {
      const text = currentChunk.map((s) => s.text).join(" ");
      chunks.push({
        text,
        start_time: currentChunk[0].offset,
        end_time:
          currentChunk[currentChunk.length - 1].offset +
          currentChunk[currentChunk.length - 1].duration,
      });

      // Keep overlap
      const overlapSegs: TranscriptSegment[] = [];
      let overlapCount = 0;
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        overlapCount += estimateTokens(currentChunk[i].text);
        overlapSegs.unshift(currentChunk[i]);
        if (overlapCount >= overlapTokens) break;
      }
      currentChunk = overlapSegs;
      currentTokens = overlapSegs.reduce(
        (sum, s) => sum + estimateTokens(s.text),
        0
      );
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.map((s) => s.text).join(" "),
      start_time: currentChunk[0].offset,
      end_time:
        currentChunk[currentChunk.length - 1].offset +
        currentChunk[currentChunk.length - 1].duration,
    });
  }

  return chunks;
}

export async function saveVideo(video: VideoInfo): Promise<void> {
  await query(
    `INSERT INTO videos (video_id, title, url, published_at, duration, transcript_status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (video_id) DO NOTHING`,
    [video.video_id, video.title, video.url, video.published_at, video.duration]
  );
}

export async function updateVideoStatus(
  videoId: string,
  status: Video["transcript_status"]
): Promise<void> {
  await query(
    "UPDATE videos SET transcript_status = $1 WHERE video_id = $2",
    [status, videoId]
  );
}
