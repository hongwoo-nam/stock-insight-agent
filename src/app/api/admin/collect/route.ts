import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupabase } from "@/lib/db/client";
import { YoutubeTranscript } from "youtube-transcript";
import OpenAI from "openai";
import { getSetting } from "@/lib/db/settings";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

const DEFAULT_CHANNELS = [
  { handle: "@syukaworld", name: "슈카월드" },
  { handle: "@kvnews", name: "한국경제TV" },
];

function sse(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

async function getChannelId(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/${handle}`, { headers: HEADERS });
    const html = await res.text();
    return html.match(/"channelId":"(UC[^"]+)"/)?.[1] ?? null;
  } catch { return null; }
}

async function fetchChannelVideos(handle: string, channelName: string) {
  const channelId = await getChannelId(handle);
  if (!channelId) return [];
  const rss = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const text = await rss.text();
  const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.slice(0, 30).flatMap(e => {
    const idM = e[1].match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleM = e[1].match(/<title>([^<]+)<\/title>/);
    const pubM = e[1].match(/<published>([^<]+)<\/published>/);
    if (!idM || !titleM) return [];
    return [{ video_id: idM[1], title: titleM[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"'), url: `https://www.youtube.com/watch?v=${idM[1]}`, published_at: pubM?.[1] ?? new Date().toISOString(), channel_name: channelName }];
  });
}

function isWithinOneWeek(text: string): boolean {
  if (!text) return false;
  if (/초 전|second/i.test(text)) return true;
  if (/분 전|minute/i.test(text)) return true;
  if (/시간 전|hour/i.test(text)) return true;
  const d = text.match(/(\d+)\s*(일 전|day)/i);
  if (d && parseInt(d[1]) <= 7) return true;
  if (/1주 전|1 week/i.test(text)) return true;
  return false;
}

async function searchYouTube(keyword: string): Promise<{ video_id: string; title: string; url: string; published_at: string; channel_name: string }[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgQIAxAB&gl=KR&hl=ko`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  const idx = html.indexOf("var ytInitialData = "); const endIdx = html.indexOf(";<\/script>", idx); const match = idx >= 0 && endIdx >= 0 ? [null, html.slice(idx + 20, endIdx)] : null;
  if (!match || !match[1]) return [];
  let data: Record<string, unknown>;
  try { data = JSON.parse(match[1] as string); } catch { return []; }

  const videos: { video_id: string; title: string; url: string; published_at: string; channel_name: string }[] = [];
  const seen = new Set<string>();

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    const o = obj as Record<string, unknown>;
    if (o.videoRenderer) {
      const vr = o.videoRenderer as Record<string, unknown>;
      const videoId = vr.videoId as string;
      if (!videoId || seen.has(videoId)) return;
      seen.add(videoId);
      const title = ((vr.title as Record<string, unknown>)?.runs as { text: string }[])?.[0]?.text || videoId;
      const channelName = ((vr.ownerText as Record<string, unknown>)?.runs as { text: string }[])?.[0]?.text || "unknown";
      const publishedText = (vr.publishedTimeText as Record<string, unknown>)?.simpleText as string || "";
      if (!isWithinOneWeek(publishedText)) return;
      videos.push({ video_id: videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, published_at: new Date().toISOString(), channel_name: channelName });
      return;
    }
    Object.values(o).forEach(walk);
  }
  walk(data);
  return videos.slice(0, 15);
}

function chunkTranscript(segments: { text: string; offset: number; duration: number }[]) {
  const chunks: { text: string; start_time: number; end_time: number }[] = [];
  const est = (t: string) => Math.ceil(t.length / 2);
  let cur: typeof segments = [], curTokens = 0;
  for (const seg of segments) {
    cur.push(seg);
    curTokens += est(seg.text);
    if (curTokens >= 1000) {
      chunks.push({ text: cur.map(s => s.text).join(" "), start_time: cur[0].offset, end_time: cur[cur.length - 1].offset + cur[cur.length - 1].duration });
      let oc = 0; const overlap: typeof segments = [];
      for (let i = cur.length - 1; i >= 0; i--) { oc += est(cur[i].text); overlap.unshift(cur[i]); if (oc >= 150) break; }
      cur = overlap; curTokens = cur.reduce((s, x) => s + est(x.text), 0);
    }
  }
  if (cur.length) chunks.push({ text: cur.map(s => s.text).join(" "), start_time: cur[0].offset, end_time: cur[cur.length - 1].offset + cur[cur.length - 1].duration });
  return chunks;
}

async function processVideo(
  video: { video_id: string; title: string; url: string; published_at: string; channel_name: string },
  openai: OpenAI,
  supabase: ReturnType<typeof getSupabase>
): Promise<{ status: "done" | "no_transcript"; chunks?: number }> {
  let segments: { text: string; offset: number; duration: number }[];
  try {
    const raw = await (YoutubeTranscript.fetchTranscript(video.video_id, { lang: "ko" }).catch(() =>
      YoutubeTranscript.fetchTranscript(video.video_id)
    ));
    segments = raw.map((s: { text: string; offset: number; duration: number }) => ({ text: s.text, offset: s.offset / 1000, duration: s.duration / 1000 }));
  } catch {
    await supabase.from("videos").upsert({ ...video, duration: 0, transcript_status: "no_transcript" }, { onConflict: "video_id" });
    return { status: "no_transcript" };
  }

  if (!segments.length) {
    await supabase.from("videos").upsert({ ...video, duration: 0, transcript_status: "no_transcript" }, { onConflict: "video_id" });
    return { status: "no_transcript" };
  }

  await supabase.from("videos").upsert({ ...video, duration: 0, transcript_status: "processing" }, { onConflict: "video_id" });

  const chunks = chunkTranscript(segments);
  for (let i = 0; i < chunks.length; i += 20) {
    const batch = chunks.slice(i, i + 20);
    const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: batch.map(c => c.text) });
    const rows = batch.map((c, j) => ({ video_id: video.video_id, chunk_index: i + j, chunk_text: c.text, start_time: c.start_time, end_time: c.end_time, embedding: JSON.stringify(embRes.data[j].embedding) }));
    await supabase.from("transcript_chunks").upsert(rows, { onConflict: "video_id,chunk_index" });
  }

  await supabase.from("videos").update({ transcript_status: "done" }).eq("video_id", video.video_id);
  return { status: "done", chunks: chunks.length };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "관리자 권한 필요" }), { status: 403 });
  }

  const { mode, keywords, channels } = await req.json();
  // mode: "channel" | "stock"
  // keywords: string[] (stock 키워드 목록)
  // channels: { handle, name }[] (channel 목록)

  const stream = new ReadableStream({
    async start(controller) {
      const supabase = getSupabase();
      const openaiKey = await getSetting("openai_api_key");
      if (!openaiKey) { sse(controller, { type: "error", message: "OpenAI API 키가 설정되지 않았습니다." }); controller.close(); return; }
      const openai = new OpenAI({ apiKey: openaiKey });

      // 14일 경과 데이터 삭제
      sse(controller, { type: "log", message: "🗑️  14일 경과 데이터 정리 중..." });
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: oldVideos } = await supabase
        .from("videos")
        .select("video_id")
        .lt("published_at", cutoff);
      if (oldVideos && oldVideos.length > 0) {
        const ids = oldVideos.map(v => v.video_id);
        await supabase.from("transcript_chunks").delete().in("video_id", ids);
        await supabase.from("videos").delete().in("video_id", ids);
        sse(controller, { type: "log", message: `   → ${ids.length}개 영상 및 관련 청크 삭제 완료` });
      } else {
        sse(controller, { type: "log", message: "   → 삭제할 데이터 없음" });
      }

      let allVideos: { video_id: string; title: string; url: string; published_at: string; channel_name: string }[] = [];

      if (mode === "channel") {
        const targetChannels = channels?.length ? channels : DEFAULT_CHANNELS;
        for (const ch of targetChannels) {
          sse(controller, { type: "log", message: `📡 ${ch.name} 채널 영상 목록 수집 중...` });
          const videos = await fetchChannelVideos(ch.handle, ch.name);
          sse(controller, { type: "log", message: `   → ${videos.length}개 발견` });
          allVideos.push(...videos);
        }
      } else {
        const targetKeywords: string[] = keywords?.length ? keywords : ["HLB 주식", "삼성전자 주식", "SK하이닉스 주식", "셀트리온 주식", "네이버 주식", "금리인상", "미국 이란 전쟁"];
        for (const kw of targetKeywords) {
          sse(controller, { type: "log", message: `🔍 "${kw}" 검색 중 (최근 1주일)...` });
          const videos = await searchYouTube(kw);
          sse(controller, { type: "log", message: `   → ${videos.length}개 발견` });
          allVideos.push(...videos);
        }
      }

      // 중복 제거
      const seen = new Set<string>();
      allVideos = allVideos.filter(v => { if (seen.has(v.video_id)) return false; seen.add(v.video_id); return true; });

      // 기존 DB 제외 (no_transcript 재시도 포함)
      const { data: existing } = await supabase.from("videos").select("video_id, transcript_status").in("video_id", allVideos.map(v => v.video_id));
      const existingMap = Object.fromEntries((existing || []).map(r => [r.video_id, r.transcript_status]));
      const toProcess = allVideos.filter(v => !existingMap[v.video_id] || existingMap[v.video_id] === "no_transcript");

      sse(controller, { type: "log", message: `\n📋 처리할 영상: ${toProcess.length}개` });
      sse(controller, { type: "progress", total: toProcess.length, done: 0 });

      let done = 0, noTranscript = 0, failed = 0;

      for (let i = 0; i < toProcess.length; i++) {
        const video = toProcess[i];
        sse(controller, { type: "log", message: `[${i + 1}/${toProcess.length}] ${video.title?.slice(0, 45)}...` });
        try {
          const result = await processVideo(video, openai, supabase);
          if (result.status === "done") {
            sse(controller, { type: "log", message: `   ✅ 완료 (${result.chunks}청크)` });
            done++;
          } else {
            sse(controller, { type: "log", message: `   ⚠️  자막 없음` });
            noTranscript++;
          }
        } catch (e) {
          sse(controller, { type: "log", message: `   ❌ 오류: ${e instanceof Error ? e.message.slice(0, 60) : ""}` });
          failed++;
        }
        sse(controller, { type: "progress", total: toProcess.length, done: i + 1 });
        await new Promise(r => setTimeout(r, 500));
      }

      const { count } = await supabase.from("transcript_chunks").select("*", { count: "exact", head: true });
      sse(controller, { type: "done", message: `\n✅ 수집 완료: ${done}개 처리, ${noTranscript}개 자막없음, ${failed}개 실패\n📊 총 저장 청크 수: ${count}`, stats: { done, noTranscript, failed, totalChunks: count } });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}
