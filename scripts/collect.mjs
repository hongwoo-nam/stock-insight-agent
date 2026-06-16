#!/usr/bin/env node
/**
 * 로컬 수집 스크립트
 * - 모드 1 (기본): 슈카월드 & 한국경제TV 채널 최신 영상 수집
 * - 모드 2 (--stock): 종목 키워드로 최근 1주일 YouTube 검색 수집
 *
 * 실행:
 *   node scripts/collect.mjs              # 채널 수집
 *   node scripts/collect.mjs --stock      # 종목 키워드 검색 수집
 */

import { createClient } from "@supabase/supabase-js";
import { YoutubeTranscript } from "youtube-transcript";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envFile = readFileSync(join(__dirname, "../.env.local"), "utf-8");
    for (const line of envFile.split("\n")) {
      const [key, ...val] = line.split("=");
      if (key && val.length) process.env[key.trim()] = val.join("=").trim();
    }
  } catch {
    console.log("⚠️  .env.local not found — using process.env");
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPENAI_API_KEY) {
  console.error("❌ 환경변수 누락: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY 필요");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

// ── 종목 키워드 목록 ──────────────────────────────────────────
const STOCK_KEYWORDS = [
  { keyword: "HLB 주식", tag: "HLB" },
  { keyword: "삼성전자 주식", tag: "삼성전자" },
  { keyword: "SK하이닉스 주식", tag: "하이닉스" },
  { keyword: "셀트리온 주식", tag: "셀트리온" },
  { keyword: "네이버 주식", tag: "네이버" },
  { keyword: "금리인상", tag: "금리" },
  { keyword: "미국 이란 전쟁", tag: "미이란" },
];

// ── 채널 목록 ─────────────────────────────────────────────────
const TARGET_CHANNELS = [
  { handle: "@syukaworld", name: "슈카월드" },
  { handle: "@kvnews", name: "한국경제TV" },
];

// ─────────────────────────────────────────────────────────────
// YouTube 검색 결과 스크래핑 (API 키 불필요)
// sp=EgQIAxAB → "이번 주" 필터
// ─────────────────────────────────────────────────────────────
async function searchYouTube(keyword, maxResults = 15) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgQIAxAB`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();

  // ytInitialData JSON 추출
  const match = html.match(/var ytInitialData = ({.+?});<\/script>/s);
  if (!match) return [];

  let data;
  try { data = JSON.parse(match[1]); } catch { return []; }

  const videos = [];
  const seen = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }

    if (obj.videoRenderer) {
      const vr = obj.videoRenderer;
      const videoId = vr.videoId;
      if (!videoId || seen.has(videoId)) return;
      seen.add(videoId);

      const title = vr.title?.runs?.[0]?.text || `영상 ${videoId}`;
      const channelName = vr.ownerText?.runs?.[0]?.text || "unknown";
      const publishedText = vr.publishedTimeText?.simpleText || "";

      // 1주일 이내 필터 (초, 분, 시간, 일, 주 단위 텍스트 파싱)
      if (!isWithinOneWeek(publishedText)) return;

      videos.push({
        video_id: videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        published_at: new Date().toISOString(),
        duration: 0,
        channel_name: channelName,
      });
      return;
    }

    Object.values(obj).forEach(walk);
  }

  walk(data);
  return videos.slice(0, maxResults);
}

function isWithinOneWeek(text) {
  if (!text) return false;
  // 한국어/영어 모두 처리
  if (/초 전|second/i.test(text)) return true;
  if (/분 전|minute/i.test(text)) return true;
  if (/시간 전|hour/i.test(text)) return true;
  const dayMatch = text.match(/(\d+)\s*(일 전|day)/i);
  if (dayMatch && parseInt(dayMatch[1]) <= 7) return true;
  if (/1주 전|1 week/i.test(text)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// 채널 RSS 수집
// ─────────────────────────────────────────────────────────────
async function getChannelId(handle) {
  const res = await fetch(`https://www.youtube.com/${handle}`, { headers: HEADERS });
  const html = await res.text();
  const match = html.match(/"channelId":"(UC[^"]+)"/);
  return match?.[1] ?? null;
}

async function fetchChannelVideoIds(handle, channelName, maxResults = 30) {
  const channelId = await getChannelId(handle);
  if (!channelId) return [];

  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const rssRes = await fetch(rssUrl);
  const rssText = await rssRes.text();
  const entries = [...rssText.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];

  const videos = [];
  for (const entry of entries.slice(0, maxResults)) {
    const content = entry[1];
    const idMatch = content.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleMatch = content.match(/<title>([^<]+)<\/title>/);
    const publishedMatch = content.match(/<published>([^<]+)<\/published>/);
    if (!idMatch || !titleMatch) continue;
    const title = titleMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    videos.push({
      video_id: idMatch[1],
      title,
      url: `https://www.youtube.com/watch?v=${idMatch[1]}`,
      published_at: publishedMatch?.[1] || new Date().toISOString(),
      duration: 0,
      channel_name: channelName,
    });
  }
  return videos;
}

// ─────────────────────────────────────────────────────────────
// 자막 수집 → 청크 → 임베딩 → Supabase 저장
// ─────────────────────────────────────────────────────────────
function chunkTranscript(segments, chunkTokens = 1000, overlapTokens = 150) {
  const chunks = [];
  const est = (t) => Math.ceil(t.length / 2);
  let cur = [], curTokens = 0;

  for (const seg of segments) {
    cur.push(seg);
    curTokens += est(seg.text);
    if (curTokens >= chunkTokens) {
      chunks.push({ text: cur.map(s => s.text).join(" "), start_time: cur[0].offset, end_time: cur[cur.length - 1].offset + cur[cur.length - 1].duration });
      const overlap = [];
      let oc = 0;
      for (let i = cur.length - 1; i >= 0; i--) {
        oc += est(cur[i].text);
        overlap.unshift(cur[i]);
        if (oc >= overlapTokens) break;
      }
      cur = overlap;
      curTokens = cur.reduce((s, x) => s + est(x.text), 0);
    }
  }
  if (cur.length) chunks.push({ text: cur.map(s => s.text).join(" "), start_time: cur[0].offset, end_time: cur[cur.length - 1].offset + cur[cur.length - 1].duration });
  return chunks;
}

async function createEmbeddingsBatch(texts) {
  const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: texts });
  return res.data.map(d => d.embedding);
}

async function processVideo(video) {
  let segments;
  try {
    const raw = await YoutubeTranscript.fetchTranscript(video.video_id, { lang: "ko" }).catch(() =>
      YoutubeTranscript.fetchTranscript(video.video_id)
    );
    segments = raw.map(s => ({ text: s.text, offset: s.offset / 1000, duration: s.duration / 1000 }));
  } catch (e) {
    return { status: "no_transcript", error: e.message };
  }

  if (!segments.length) return { status: "no_transcript" };

  await supabase.from("videos").upsert({
    video_id: video.video_id, title: video.title, url: video.url,
    published_at: video.published_at, duration: video.duration,
    channel_name: video.channel_name, transcript_status: "processing",
  }, { onConflict: "video_id" });

  const chunks = chunkTranscript(segments);
  const BATCH = 20;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embeddings = await createEmbeddingsBatch(batch.map(c => c.text));
    const rows = batch.map((c, j) => ({
      video_id: video.video_id, chunk_index: i + j,
      chunk_text: c.text, start_time: c.start_time, end_time: c.end_time,
      embedding: JSON.stringify(embeddings[j]),
    }));
    await supabase.from("transcript_chunks").upsert(rows, { onConflict: "video_id,chunk_index" });
  }

  await supabase.from("videos").update({ transcript_status: "done" }).eq("video_id", video.video_id);
  return { status: "done", chunks: chunks.length };
}

async function processVideos(videos, label) {
  const { data: existing } = await supabase.from("videos")
    .select("video_id, transcript_status")
    .in("video_id", videos.map(v => v.video_id));
  const existingMap = Object.fromEntries((existing || []).map(r => [r.video_id, r.transcript_status]));
  const toProcess = videos.filter(v => !existingMap[v.video_id] || existingMap[v.video_id] === "no_transcript");

  if (!toProcess.length) { console.log(`   → 신규 영상 없음\n`); return { done: 0, noTranscript: 0, failed: 0 }; }
  console.log(`   → ${toProcess.length}개 처리 예정\n`);

  let done = 0, noTranscript = 0, failed = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const video = toProcess[i];
    process.stdout.write(`  [${i + 1}/${toProcess.length}] ${video.title?.slice(0, 45)}... `);
    try {
      const result = await processVideo(video);
      if (result.status === "done") { console.log(`✓ (${result.chunks}청크)`); done++; }
      else {
        console.log(`⚠ 자막없음`);
        await supabase.from("videos").upsert({
          video_id: video.video_id, title: video.title, url: video.url,
          published_at: video.published_at, duration: video.duration || 0,
          channel_name: video.channel_name || "unknown", transcript_status: "no_transcript",
        }, { onConflict: "video_id" });
        noTranscript++;
      }
    } catch (e) { console.log(`✗ ${e.message?.slice(0, 50)}`); failed++; }
    await new Promise(r => setTimeout(r, 600));
  }
  return { done, noTranscript, failed };
}

// ─────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────
async function main() {
  const stockMode = process.argv.includes("--stock");

  if (stockMode) {
    console.log("🔍 종목 키워드 검색 수집 모드 (최근 1주일)\n");
    let totalDone = 0, totalNoTranscript = 0, totalFailed = 0;

    for (const { keyword, tag } of STOCK_KEYWORDS) {
      console.log(`📌 [${tag}] "${keyword}" 검색 중...`);
      const videos = await searchYouTube(keyword, 15);
      console.log(`   → ${videos.length}개 영상 발견`);

      if (!videos.length) { console.log(); continue; }
      videos.forEach(v => console.log(`     • ${v.channel_name} | ${v.title?.slice(0, 50)}`));
      console.log();

      const stats = await processVideos(videos, tag);
      totalDone += stats.done;
      totalNoTranscript += stats.noTranscript;
      totalFailed += stats.failed;

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n✅ 종목 수집 완료: ${totalDone}개 처리, ${totalNoTranscript}개 자막없음, ${totalFailed}개 실패`);

  } else {
    console.log("🚀 슈카월드 & 한국경제TV 채널 수집 시작\n");
    const allVideos = [];
    const seen = new Set();

    for (const ch of TARGET_CHANNELS) {
      console.log(`📡 ${ch.name} 채널 영상 목록 수집 중...`);
      const videos = await fetchChannelVideoIds(ch.handle, ch.name, 30);
      console.log(`   → ${videos.length}개 발견`);
      for (const v of videos) {
        if (!seen.has(v.video_id)) { seen.add(v.video_id); allVideos.push(v); }
      }
    }

    // 기존 no_transcript 재시도
    const { data: retryVideos } = await supabase.from("videos")
      .select("*").eq("transcript_status", "no_transcript").limit(50);
    for (const v of retryVideos || []) {
      if (!seen.has(v.video_id)) { seen.add(v.video_id); allVideos.push(v); }
    }

    console.log();
    const stats = await processVideos(allVideos, "채널");
    console.log(`\n✅ 완료: ${stats.done}개 처리, ${stats.noTranscript}개 자막없음, ${stats.failed}개 실패`);
  }

  const { count } = await supabase.from("transcript_chunks").select("*", { count: "exact", head: true });
  console.log(`📊 총 저장 청크 수: ${count}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
