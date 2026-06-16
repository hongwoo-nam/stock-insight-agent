import { YoutubeTranscript } from "youtube-transcript";
import { getSupabase } from "@/lib/db/client";

export interface VideoInfo {
  video_id: string;
  title: string;
  url: string;
  published_at: string;
  duration: number;
}

async function getChannelId(): Promise<string> {
  // Fetch channel page and extract channel ID from HTML
  const res = await fetch("https://www.youtube.com/@syukaworld", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
  });
  const html = await res.text();
  const match = html.match(/"channelId":"(UC[^"]+)"/);
  if (!match) throw new Error("Could not extract channel ID from YouTube page");
  return match[1];
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function fetchChannelVideos(
  _apiKey: string,
  maxResults = 50
): Promise<VideoInfo[]> {
  const channelId = await getChannelId();
  const videos: VideoInfo[] = [];
  const seen = new Set<string>();

  // RSS feed — latest 15 videos, no API key required
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const rssRes = await fetch(rssUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
  });
  const rssText = await rssRes.text();
  const entries = [...rssText.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];

  for (const entry of entries) {
    const content = entry[1];
    const videoIdMatch = content.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleMatch = content.match(/<title>([^<]+)<\/title>/);
    const publishedMatch = content.match(/<published>([^<]+)<\/published>/);
    if (!videoIdMatch || !titleMatch) continue;
    const videoId = videoIdMatch[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({
      video_id: videoId,
      title: decodeHtml(titleMatch[1]),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      published_at: publishedMatch?.[1] || new Date().toISOString(),
      duration: 0,
    });
  }

  // If more videos needed, scrape channel page for additional IDs
  if (videos.length < maxResults) {
    try {
      const pageRes = await fetch(`https://www.youtube.com/@syukaworld/videos`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
      });
      const pageHtml = await pageRes.text();
      // Extract video IDs from page JSON data
      const idMatches = [...pageHtml.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)];
      const titleMatches = [...pageHtml.matchAll(/"title":{"runs":\[{"text":"([^"]+)"/g)];

      for (let i = 0; i < idMatches.length && videos.length < maxResults; i++) {
        const videoId = idMatches[i][1];
        if (seen.has(videoId)) continue;
        seen.add(videoId);
        const title = titleMatches[i]?.[1] ? decodeHtml(titleMatches[i][1]) : `영상 ${videoId}`;
        videos.push({
          video_id: videoId,
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          published_at: new Date().toISOString(),
          duration: 0,
        });
      }
    } catch {
      // Channel page scraping failed — use RSS results only
    }
  }

  if (!videos.length) throw new Error("No videos found");
  return videos.slice(0, maxResults);
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
