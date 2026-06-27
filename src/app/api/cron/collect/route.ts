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


// DART 공시 모니터링 종목
const DART_COMPANIES: { corpCode: string; name: string; stockCode: string }[] = [
  { corpCode: "00064420", name: "HLB",    stockCode: "028300" },
  { corpCode: "00126380", name: "삼성전자", stockCode: "005930" },
  { corpCode: "00164779", name: "SK하이닉스", stockCode: "000660" },
  { corpCode: "00131947", name: "셀트리온", stockCode: "068270" },
  { corpCode: "00293886", name: "NAVER",  stockCode: "035420" },
];

// 경제 뉴스 RSS 피드
const NEWS_RSS_FEEDS = [
  { url: "https://www.hankyung.com/feed/economy", name: "한국경제" },
  { url: "https://rss.mt.co.kr/mt_eco_news.xml", name: "머니투데이" },
  { url: "https://www.mk.co.kr/rss/30100041/", name: "매일경제" },
  { url: "https://www.etnews.com/rss/section/etnews_02.xml", name: "전자신문" },
  { url: "https://rss.edaily.co.kr/edaily_stock.xml", name: "이데일리" },
];

// Google News RSS 검색 키워드 (주가 모멘텀 이슈 중심)
const GOOGLE_NEWS_KEYWORDS = [
  "삼성전자 자사주", "삼성전자 실적", "삼성전자 배당", "삼성전자 ADR",
  "SK하이닉스 실적", "SK하이닉스 HBM", "SK하이닉스 자사주",
  "HLB FDA 승인", "HLB 임상",
  "셀트리온 실적", "셀트리온 자사주",
  "네이버 실적", "네이버 자사주",
  "코스피 외국인 매수", "코스피 자사주",
];

type YTVideo = { video_id: string; title: string; url: string; published_at: string; channel_name: string; description: string };

// YouTube Data API v3 - 키워드 검색 (최근 7일)
async function searchYouTubeAPI(keyword: string, apiKey: string): Promise<YTVideo[]> {
  const publishedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&type=video&order=date&publishedAfter=${publishedAfter}&maxResults=10&regionCode=KR&relevanceLanguage=ko&key=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (!data.items) return [];
  return data.items.map((item: Record<string, unknown>) => {
    const snippet = item.snippet as Record<string, unknown>;
    const id = (item.id as Record<string, unknown>).videoId as string;
    return {
      video_id: id,
      title: snippet.title as string,
      url: `https://www.youtube.com/watch?v=${id}`,
      published_at: snippet.publishedAt as string,
      channel_name: snippet.channelTitle as string,
      description: (snippet.description as string) || "",
    };
  });
}

// YouTube Data API v3 - 채널별 최신 영상
async function fetchChannelVideosAPI(channelId: string, channelName: string, apiKey: string): Promise<YTVideo[]> {
  const publishedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&publishedAfter=${publishedAfter}&maxResults=10&key=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (!data.items) return [];
  return data.items.map((item: Record<string, unknown>) => {
    const snippet = item.snippet as Record<string, unknown>;
    const id = (item.id as Record<string, unknown>).videoId as string;
    return {
      video_id: id,
      title: snippet.title as string,
      url: `https://www.youtube.com/watch?v=${id}`,
      published_at: snippet.publishedAt as string,
      channel_name: channelName,
      description: (snippet.description as string) || "",
    };
  });
}

// 슈카월드 채널 ID
const CHANNEL_IDS: { id: string; name: string }[] = [
  { id: "UCEDkO7wsjMFkuHm-jFyLMHQ", name: "슈카월드" },
  { id: "UCHlGCLNnHXc4KOjEBnQn4AQ", name: "한국경제TV" },
];

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

// Google News RSS로 키워드별 뉴스 수집 (3일 이내)
async function fetchGoogleNewsRss(): Promise<{ id: string; title: string; url: string; text: string; channelName: string }[]> {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const items: { id: string; title: string; url: string; text: string; channelName: string }[] = [];
  const seen = new Set<string>();

  for (const keyword of GOOGLE_NEWS_KEYWORDS) {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
      const res = await fetch(rssUrl, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      const xml = await res.text();

      const entries = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      for (const entry of entries.slice(0, 5)) {
        const content = entry[1];
        const titleM = content.match(/<title>([\s\S]*?)<\/title>/);
        const linkM  = content.match(/<link>([\s\S]*?)<\/link>/);
        const pubM   = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const descM  = content.match(/<description>([\s\S]*?)<\/description>/);

        if (!titleM || !linkM) continue;

        const pubTime = pubM ? new Date(pubM[1].trim()).getTime() : Date.now();
        if (!isNaN(pubTime) && pubTime < threeDaysAgo) continue;

        const title = titleM[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
        const link  = linkM[1].trim();
        const desc  = descM ? descM[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() : "";

        if (seen.has(title)) continue;
        seen.add(title);

        const id = `gnews_${Buffer.from(keyword + title).toString("base64").slice(0, 30)}`;
        items.push({
          id,
          title,
          url: link,
          text: `[키워드: ${keyword}]\n제목: ${title}\n${desc}`,
          channelName: "Google뉴스",
        });
      }
    } catch { /* 오류 무시 */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return items;
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
  video: YTVideo,
  openai: OpenAI,
  supabase: ReturnType<typeof getSupabase>
): Promise<"done" | "no_transcript" | "failed"> {
  // 자막 시도 (실패하면 제목+설명으로 fallback)
  let contentText = "";
  try {
    const raw = await YoutubeTranscript.fetchTranscript(video.video_id, { lang: "ko" }).catch(() =>
      YoutubeTranscript.fetchTranscript(video.video_id)
    );
    if (raw.length > 0) {
      contentText = raw.map((s: { text: string }) => s.text).join(" ");
    }
  } catch { /* 자막 없음 → 설명으로 대체 */ }

  // 자막 없으면 제목 + 설명 사용
  if (!contentText && video.description) {
    contentText = `[영상 제목] ${video.title}\n\n[영상 설명]\n${video.description}`;
  }

  if (!contentText) {
    await supabase.from("videos").upsert(
      { ...video, duration: 0, transcript_status: "no_transcript" },
      { onConflict: "video_id" }
    );
    return "no_transcript";
  }

  try {
    await supabase.from("videos").upsert(
      { ...video, duration: 0, transcript_status: "processing" },
      { onConflict: "video_id" }
    );
    const chunks: { text: string; start: number }[] = [];
    for (let i = 0; i < contentText.length; i += 1800) {
      chunks.push({ text: contentText.slice(i, i + 1800), start: i });
    }
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20);
      const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: batch.map(c => c.text) });
      void logUsage("embedding", "text-embedding-3-small", embRes.usage?.total_tokens ?? 0, 0);
      const rows = batch.map((c, j) => ({
        video_id: video.video_id, chunk_index: i + j, chunk_text: c.text,
        start_time: c.start, end_time: c.start + c.text.length,
        embedding: JSON.stringify(embRes.data[j].embedding),
      }));
      await supabase.from("transcript_chunks").upsert(rows, { onConflict: "video_id,chunk_index" });
    }
    await supabase.from("videos").update({ transcript_status: "done" }).eq("video_id", video.video_id);
    return "done";
  } catch {
    return "failed";
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
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;

  // 14일 경과 데이터 삭제
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: oldVideos } = await supabase.from("videos").select("video_id").lt("published_at", cutoff);
  if (oldVideos?.length) {
    const ids = oldVideos.map(v => v.video_id);
    await supabase.from("transcript_chunks").delete().in("video_id", ids);
    await supabase.from("videos").delete().in("video_id", ids);
  }

  // 영상 수집 (YouTube Data API v3 사용, 없으면 스킵)
  let allVideos: YTVideo[] = [];

  if (youtubeApiKey) {
    for (const kw of DEFAULT_KEYWORDS) {
      const videos = await searchYouTubeAPI(kw, youtubeApiKey).catch(() => []);
      allVideos.push(...videos);
    }
    for (const ch of CHANNEL_IDS) {
      const videos = await fetchChannelVideosAPI(ch.id, ch.name, youtubeApiKey).catch(() => []);
      allVideos.push(...videos);
    }
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

  // 뉴스 RSS + Google News + DART 공시 수집
  const [newsItems, googleNewsItems, dartItems] = await Promise.all([
    fetchRssNews(),
    fetchGoogleNewsRss(),
    fetchDartDisclosures(),
  ]);
  const extraItems = [...newsItems, ...googleNewsItems, ...dartItems];

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

  // 수집된 전체 뉴스/공시 기반 주요 이슈 요약 (Google뉴스+DART 우선)
  const issueSummary = await generateIssueSummary(
    [...googleNewsItems, ...dartItems, ...newsItems]
      .map(i => ({ title: i.title, text: i.text, channelName: i.channelName })),
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
      `영상 ${done}완료 / 뉴스+공시 ${newsDone}건 (Google뉴스 ${googleNewsItems.length}건 포함)`,
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
