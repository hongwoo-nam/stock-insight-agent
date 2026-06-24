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

// DART 공시 모니터링 종목 (종목코드: 회사명)
const DART_COMPANIES: { corpCode: string; name: string }[] = [
  { corpCode: "00064420", name: "HLB" },
  { corpCode: "00126380", name: "삼성전자" },
  { corpCode: "00164779", name: "SK하이닉스" },
  { corpCode: "00131947", name: "셀트리온" },
  { corpCode: "00293886", name: "NAVER" },
];

// 경제 뉴스 RSS 피드
const NEWS_RSS_FEEDS = [
  { url: "https://www.hankyung.com/feed/economy", name: "한국경제" },
  { url: "https://rss.mt.co.kr/mt_eco_news.xml", name: "머니투데이" },
  { url: "https://www.mk.co.kr/rss/30100041/", name: "매일경제" },
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

// 뉴스/공시를 video 레코드처럼 저장 (기존 RAG 파이프라인 재활용)
async function storeTextAsChunks(
  id: string,
  title: string,
  url: string,
  text: string,
  channelName: string,
  openai: OpenAI,
  supabase: ReturnType<typeof getSupabase>
): Promise<"done" | "skip" | "failed"> {
  if (!text || text.length < 50) return "skip";
  try {
    await supabase.from("videos").upsert(
      { video_id: id, title, url, published_at: new Date().toISOString(), channel_name: channelName, duration: 0, transcript_status: "processing" },
      { onConflict: "video_id" }
    );
    // 2000자 단위로 청크
    const chunks: { text: string; start: number }[] = [];
    for (let i = 0; i < text.length; i += 1800) {
      chunks.push({ text: text.slice(i, i + 1800), start: i });
    }
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20);
      const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: batch.map(c => c.text) });
      void logUsage("embedding", "text-embedding-3-small", embRes.usage?.total_tokens ?? 0, 0);
      const rows = batch.map((c, j) => ({
        video_id: id, chunk_index: i + j, chunk_text: c.text,
        start_time: c.start, end_time: c.start + c.text.length,
        embedding: JSON.stringify(embRes.data[j].embedding),
      }));
      await supabase.from("transcript_chunks").upsert(rows, { onConflict: "video_id,chunk_index" });
    }
    await supabase.from("videos").update({ transcript_status: "done" }).eq("video_id", id);
    return "done";
  } catch {
    return "failed";
  }
}

async function fetchRssNews(): Promise<{ id: string; title: string; url: string; text: string; channelName: string }[]> {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const items: { id: string; title: string; url: string; text: string; channelName: string }[] = [];

  for (const feed of NEWS_RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      const xml = await res.text();
      const entries = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      for (const entry of entries.slice(0, 20)) {
        const content = entry[1];
        const titleM = content.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) || content.match(/<title>([^<]+)<\/title>/);
        const linkM = content.match(/<link>([^<]+)<\/link>/) || content.match(/<guid[^>]*>([^<]+)<\/guid>/);
        const pubM = content.match(/<pubDate>([^<]+)<\/pubDate>/);
        const descM = content.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/) || content.match(/<description>([^<]+)<\/description>/);

        if (!titleM || !linkM) continue;
        if (pubM) {
          const pubTime = new Date(pubM[1]).getTime();
          if (isNaN(pubTime) || pubTime < threeDaysAgo) continue;
        }

        const title = titleM[1].trim();
        const url = linkM[1].trim();
        const desc = descM ? descM[1].replace(/<[^>]+>/g, " ").trim() : "";
        const id = `news_${Buffer.from(url).toString("base64").slice(0, 40)}`;
        items.push({ id, title, url, text: `${title}\n\n${desc}`, channelName: feed.name });
      }
    } catch { /* 피드 오류 무시 */ }
  }
  return items;
}

async function fetchDartDisclosures(): Promise<{ id: string; title: string; url: string; text: string; channelName: string }[]> {
  const dartKey = process.env.DART_API_KEY;
  if (!dartKey) return [];

  const items: { id: string; title: string; url: string; text: string; channelName: string }[] = [];
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const bgnDe = threeDaysAgo.toISOString().slice(0, 10).replace(/-/g, "");
  const endDe = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  for (const company of DART_COMPANIES) {
    try {
      const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&corp_code=${company.corpCode}&bgn_de=${bgnDe}&end_de=${endDe}&page_no=1&page_count=20`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      if (data.status !== "000" || !data.list) continue;

      for (const item of data.list) {
        const id = `dart_${item.rcept_no}`;
        const title = `[${company.name} 공시] ${item.report_nm}`;
        const discUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`;
        const text = `${title}\n제출인: ${item.flr_nm}\n접수일: ${item.rcept_dt}\n공시유형: ${item.report_nm}`;
        items.push({ id, title, url: discUrl, text, channelName: "DART공시" });
      }
    } catch { /* DART 오류 무시 */ }
  }
  return items;
}

// 수집된 뉴스/공시에서 주요 이슈 요약 생성
async function generateIssueSummary(
  items: { title: string; text: string; channelName: string }[],
  openai: OpenAI
): Promise<string | null> {
  if (items.length === 0) return null;

  const inputText = items
    .slice(0, 30) // 최대 30건
    .map(i => `[${i.channelName}] ${i.title}\n${i.text.slice(0, 300)}`)
    .join("\n\n---\n\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `당신은 주식 투자 정보를 간결하게 요약하는 AI입니다.
아래 규칙을 반드시 지켜서 SMS용 요약문을 작성하세요:
- 실적, 자사주 매입, ADR 상장, 유상증자, 주요 계약, 기관/외국인 매매, 주가 급등락 이슈만 추출
- 관련 없는 일반 뉴스는 제외
- 종목명과 핵심 수치(금액, %, 날짜)를 반드시 포함
- 전체 600자 이내
- 형식: 종목 [이슈유형] 핵심내용 (예: 삼성전자 [실적] 2Q 영업이익 10조원, 전년比 +50%)
- 이슈가 없으면 "주요 이슈 없음"으로만 답변`,
        },
        {
          role: "user",
          content: `최근 2~3일 수집된 뉴스/공시입니다. 주요 이슈를 요약해주세요:\n\n${inputText}`,
        },
      ],
    });
    void logUsage("chat", "gpt-4o-mini", completion.usage?.prompt_tokens ?? 0, completion.usage?.completion_tokens ?? 0);
    return completion.choices[0].message.content?.trim() ?? null;
  } catch {
    return null;
  }
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

  // 뉴스 RSS + DART 공시 수집
  const [newsItems, dartItems] = await Promise.all([fetchRssNews(), fetchDartDisclosures()]);
  const extraItems = [...newsItems, ...dartItems];

  // 기존 처리된 항목 제외
  const { data: existingExtra } = await supabase
    .from("videos").select("video_id, transcript_status")
    .in("video_id", extraItems.map(i => i.id));
  const existingExtraMap = Object.fromEntries((existingExtra ?? []).map(r => [r.video_id, r.transcript_status]));
  const toProcessExtra = extraItems.filter(i => existingExtraMap[i.id] !== "done");

  let newsDone = 0, newsFailed = 0;
  for (const item of toProcessExtra) {
    const status = await storeTextAsChunks(item.id, item.title, item.url, item.text, item.channelName, openai, supabase);
    if (status === "done") newsDone++;
    else if (status === "failed") newsFailed++;
    await new Promise(r => setTimeout(r, 200));
  }

  // 수집된 뉴스/공시 기반 주요 이슈 요약 (새로 수집된 항목 우선)
  const issueSummary = await generateIssueSummary(
    [...newsItems, ...dartItems].map(i => ({ title: i.title, text: i.text, channelName: i.channelName })),
    openai
  ).catch(() => null);

  const { count: totalChunks } = await supabase.from("transcript_chunks").select("*", { count: "exact", head: true });
  const finishedAt = new Date().toISOString();

  // 실행 결과 + 이슈 요약 SMS 전송
  const to = process.env.COOLSMS_TO;
  let smsSent = false;
  if (to) {
    const kstTime = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    const lines = [
      `[정보수집 완료] ${kstTime}`,
      `영상 ${done}완료 / 뉴스+공시 ${newsDone}건`,
    ];
    if (issueSummary && issueSummary !== "주요 이슈 없음") {
      lines.push(`\n📌 최근 주요 이슈`);
      lines.push(issueSummary);
    } else {
      lines.push("주요 이슈 없음");
    }
    const smsText = lines.join("\n").slice(0, 2000);
    const r = await sendSMS(to, smsText).catch(() => null);
    smsSent = !!r?.ok;
  }

  return NextResponse.json({
    startedAt,
    finishedAt,
    deleted: oldVideos?.length ?? 0,
    processed: toProcess.length,
    done, noTranscript, failed,
    newsDone, newsFailed,
    totalChunks,
    smsSent,
  });
}
