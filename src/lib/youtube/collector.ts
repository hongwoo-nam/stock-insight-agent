import { getSupabase } from "@/lib/db/client";
import { fetchTranscript as fetchTranscriptDirect } from "./transcript";
export type { TranscriptSegment } from "./transcript";

export interface VideoInfo {
  video_id: string;
  title: string;
  url: string;
  published_at: string;
  duration: number;
  channel_name?: string;
}

// 수집 대상 채널 목록
export const TARGET_CHANNELS = [
  { handle: "@syukaworld", name: "슈카월드" },
  { handle: "@한국경제TV", name: "한국경제TV" },
  { handle: "@kvnews", name: "한국경제TV(kvnews)" },
];

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function getChannelIdFromHandle(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/${handle}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
    });
    const html = await res.text();
    const match = html.match(/"channelId":"(UC[^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchVideosFromChannel(
  handle: string,
  channelName: string,
  maxResults: number
): Promise<VideoInfo[]> {
  const channelId = await getChannelIdFromHandle(handle);
  if (!channelId) return [];

  const videos: VideoInfo[] = [];
  const seen = new Set<string>();

  // RSS feed (최신 15개)
  try {
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
        channel_name: channelName,
      });
    }
  } catch {
    // RSS 실패 시 계속
  }

  // 채널 페이지 스크래핑 (추가 영상)
  if (videos.length < maxResults) {
    try {
      const pageRes = await fetch(`https://www.youtube.com/${handle}/videos`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
      });
      const pageHtml = await pageRes.text();
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
          channel_name: channelName,
        });
      }
    } catch {
      // 스크래핑 실패 시 RSS 결과만 사용
    }
  }

  return videos.slice(0, maxResults);
}

export async function fetchChannelVideos(
  _apiKey: string,
  maxPerChannel = 30
): Promise<VideoInfo[]> {
  const allVideos: VideoInfo[] = [];
  const seenHandles = new Set<string>();

  for (const channel of TARGET_CHANNELS) {
    // 같은 채널 중복 방지 (kvnews와 한국경제TV 같은 경우)
    const videos = await fetchVideosFromChannel(channel.handle, channel.name, maxPerChannel);
    if (!videos.length) continue;

    for (const v of videos) {
      if (!seenHandles.has(v.video_id)) {
        seenHandles.add(v.video_id);
        allVideos.push(v);
      }
    }
  }

  if (!allVideos.length) throw new Error("No videos found from any channel");
  return allVideos;
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

export const fetchTranscript = fetchTranscriptDirect;

export type { TranscriptSegment };

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
    currentChunk.push(seg);
    currentTokens += estimateTokens(seg.text);

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

export async function updateVideoStatus(videoId: string, status: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("videos").update({ transcript_status: status }).eq("video_id", videoId);
}
