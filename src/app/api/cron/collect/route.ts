import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/db/client";
import { YoutubeTranscript } from "youtube-transcript";
import OpenAI from "openai";
import { getSetting } from "@/lib/db/settings";
import { logUsage } from "@/lib/db/usage";
import { sendSMS } from "@/lib/sms";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

const DEFAULT_KEYWORDS = [
  "HLB 주식", "삼성전자 주식", "SK하이닉스 주식",
  "셀트리온 주식", "네이버 주식", "금리인상", "미국 이란 전쟁",
];

const DEFAULT_CHANNELS = [
  { handle: "@syukaworld", name: "슈카월드" },
  { handle: "@kvnews", name: "한국경제TV" },
];

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

async function searchYouTube(keyword: string) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgQIAxAB&gl=KR&hl=ko`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  const idx = html.indexOf("var ytInitialData = ");
  const endIdx = html.indexOf(";</script>", idx);
  if (idx < 0 || endIdx < 0) return [];
  let data: Record<string, unknown>;
  try { data = JSON.parse(html.slice(idx + 20, endIdx)); } catch { return []; }

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

async function getChannelId(handle: string) {
  const res = await fetch(`https://www.youtube.com/${handle}`, { headers: HEADERS });
  const html = await res.text();
  return html.match(/"channelId":"(UC[^"]+)"/)?.[1] ?? null;
}

async function fetchChannelVideos(handle: string, channelName: string) {
  const channelId = await getChannelId(handle);
  if (!channelId) return [];
  const rss = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const text = await rss.text();
  return [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 30).flatMap(e => {
    const idM = e[1].match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleM = e[1].match(/<title>([^<]+)<\/title>/);
    const pubM = e[1].match(/<published>([^<]+)<\/published>/);
    if (!idM || !titleM) return [];
    return [{ video_id: idM[1], title: titleM[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"'), url: `https://www.youtube.com/watch?v=${idM[1]}`, published_at: pubM?.[1] ?? new Date().toISOString(), channel_name: channelName }];
  });
}

function chunkTranscript(segments: { text: string; offset: number; duration: number }[]) {
  const chunks: { text: string; start_time: number; end_time: number }[] = [];
  const est = (t: string) => Math.ceil(t.length / 2);
  let cur: typeof segments = [], curTokens = 0;
  for (const seg of segments) {
    cur.push(seg); curTokens += est(seg.text);
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
): Promise<"done" | "no_transcript" | "failed"> {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(video.video_id, { lang: "ko" }).catch(() =>
      YoutubeTranscript.fetchTranscript(video.video_id)
    );
    const segments = raw.map((s: { text: string; offset: number; duration: number }) => ({
      text: s.text, offset: s.offset / 1000, duration: s.duration / 1000,
    }));
    if (!segments.length) {
      await supabase.from("videos").upsert({ ...video, duration: 0, transcript_status: "no_transcript" }, { onConflict: "video_id" });
      return "no_transcript";
    }
    await supabase.from("videos").upsert({ ...video, duration: 0, transcript_status: "processing" }, { onConflict: "video_id" });
    const chunks = chunkTranscript(segments);
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20);
      const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: batch.map(c => c.text) });
      void logUsage("embedding", "text-embedding-3-small", embRes.usage?.total_tokens ?? 0, 0);
      const rows = batch.map((c, j) => ({ video_id: video.video_id, chunk_index: i + j, chunk_text: c.text, start_time: c.start_time, end_time: c.end_time, embedding: JSON.stringify(embRes.data[j].embedding) }));
      await supabase.from("transcript_chunks").upsert(rows, { onConflict: "video_id,chunk_index" });
    }
    await supabase.from("videos").update({ transcript_status: "done" }).eq("video_id", video.video_id);
    return "done";
  } catch {
    await supabase.from("videos").upsert({ ...video, duration: 0, transcript_status: "no_transcript" }, { onConflict: "video_id" });
    return "no_transcript";
  }
}

export async function GET(req: NextRequest) {
  // Vercel Cron은 Authorization: Bearer CRON_SECRET 헤더를 자동으로 전송
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startedAt = new Date().toISOString();
  const supabase = getSupabase();
  const openaiKey = await getSetting("openai_api_key");
  if (!openaiKey) return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 503 });
  const openai = new OpenAI({ apiKey: openaiKey });

  // 14일 경과 데이터 삭제
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: oldVideos } = await supabase.from("videos").select("video_id").lt("published_at", cutoff);
  if (oldVideos?.length) {
    const ids = oldVideos.map(v => v.video_id);
    await supabase.from("transcript_chunks").delete().in("video_id", ids);
    await supabase.from("videos").delete().in("video_id", ids);
  }

  // 영상 수집 (종목 키워드 + 채널)
  let allVideos: { video_id: string; title: string; url: string; published_at: string; channel_name: string }[] = [];

  for (const kw of DEFAULT_KEYWORDS) {
    const videos = await searchYouTube(kw).catch(() => []);
    allVideos.push(...videos);
  }
  for (const ch of DEFAULT_CHANNELS) {
    const videos = await fetchChannelVideos(ch.handle, ch.name).catch(() => []);
    allVideos.push(...videos);
  }

  // 중복 제거
  const seen = new Set<string>();
  allVideos = allVideos.filter(v => { if (seen.has(v.video_id)) return false; seen.add(v.video_id); return true; });

  // 기존 done 제외
  const { data: existing } = await supabase.from("videos").select("video_id, transcript_status").in("video_id", allVideos.map(v => v.video_id));
  const existingMap = Object.fromEntries((existing ?? []).map(r => [r.video_id, r.transcript_status]));
  const toProcess = allVideos.filter(v => !existingMap[v.video_id] || existingMap[v.video_id] === "no_transcript");

  let done = 0, noTranscript = 0, failed = 0;
  for (const video of toProcess) {
    const status = await processVideo(video, openai, supabase);
    if (status === "done") done++;
    else if (status === "no_transcript") noTranscript++;
    else failed++;
    await new Promise(r => setTimeout(r, 300));
  }

  const { count: totalChunks } = await supabase.from("transcript_chunks").select("*", { count: "exact", head: true });
  const finishedAt = new Date().toISOString();

  // 실행 결과 SMS 전송
  const to = process.env.COOLSMS_TO;
  let smsSent = false;
  if (to) {
    const kstTime = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    const smsText = [
      `[정보수집 크론 완료]`,
      `시각: ${kstTime}`,
      `수집 영상: ${toProcess.length}개 처리`,
      `완료: ${done} / 자막없음: ${noTranscript} / 실패: ${failed}`,
      `삭제(14일초과): ${oldVideos?.length ?? 0}개`,
      `전체 청크: ${totalChunks ?? 0}개`,
    ].join("\n");
    const r = await sendSMS(to, smsText).catch(() => null);
    smsSent = !!r?.ok;
  }

  return NextResponse.json({
    startedAt,
    finishedAt,
    deleted: oldVideos?.length ?? 0,
    processed: toProcess.length,
    done, noTranscript, failed,
    totalChunks,
    smsSent,
  });
}
