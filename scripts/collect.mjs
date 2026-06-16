#!/usr/bin/env node
/**
 * 로컬 수집 스크립트 — YouTube 자막 수집 후 Supabase에 직접 저장
 * 실행: node scripts/collect.mjs
 * 필요: .env.local 에 SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY 설정
 */

import { createClient } from "@supabase/supabase-js";
import { YoutubeTranscript } from "youtube-transcript";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
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

const TARGET_CHANNELS = [
  { handle: "@syukaworld", name: "슈카월드" },
  { handle: "@kvnews", name: "한국경제TV" },
];

async function getChannelId(handle) {
  const res = await fetch(`https://www.youtube.com/${handle}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
  });
  const html = await res.text();
  const match = html.match(/"channelId":"(UC[^"]+)"/);
  return match?.[1] ?? null;
}

async function fetchChannelVideoIds(handle, maxResults = 30) {
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
      channel_name: handle,
    });
  }
  return videos;
}

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
  // Get transcript
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

  // Save video
  await supabase.from("videos").upsert({
    video_id: video.video_id, title: video.title, url: video.url,
    published_at: video.published_at, duration: video.duration,
    channel_name: video.channel_name, transcript_status: "processing",
  }, { onConflict: "video_id" });

  // Chunk + embed
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

async function main() {
  console.log("🚀 슈카월드 & 한국경제TV 수집 시작\n");

  // Collect video list from all channels
  const allVideos = [];
  const seen = new Set();
  for (const ch of TARGET_CHANNELS) {
    console.log(`📡 ${ch.name} 채널 영상 목록 수집 중...`);
    const videos = await fetchChannelVideoIds(ch.handle, 30);
    console.log(`   → ${videos.length}개 발견`);
    for (const v of videos) {
      if (!seen.has(v.video_id)) { seen.add(v.video_id); allVideos.push({ ...v, channel_name: ch.name }); }
    }
  }

  // Find new + no_transcript videos
  const { data: existing } = await supabase.from("videos")
    .select("video_id, transcript_status")
    .in("video_id", allVideos.map(v => v.video_id));

  const existingMap = Object.fromEntries((existing || []).map(r => [r.video_id, r.transcript_status]));
  const toProcess = allVideos.filter(v => !existingMap[v.video_id] || existingMap[v.video_id] === "no_transcript");

  // Also retry existing no_transcript videos from DB
  const { data: retryVideos } = await supabase.from("videos")
    .select("*").eq("transcript_status", "no_transcript").limit(50);
  for (const v of retryVideos || []) {
    if (!seen.has(v.video_id)) { seen.add(v.video_id); toProcess.push(v); }
  }

  console.log(`\n📋 처리할 영상: ${toProcess.length}개 (신규 + no_transcript 재시도)\n`);

  let done = 0, noTranscript = 0, failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const video = toProcess[i];
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${video.title?.slice(0, 40)}... `);
    try {
      const result = await processVideo(video);
      if (result.status === "done") {
        console.log(`✓ (${result.chunks}개 청크)`);
        done++;
      } else {
        console.log(`⚠ 자막 없음`);
        await supabase.from("videos").upsert({
          video_id: video.video_id, title: video.title, url: video.url,
          published_at: video.published_at, duration: video.duration || 0,
          channel_name: video.channel_name || "unknown", transcript_status: "no_transcript",
        }, { onConflict: "video_id" });
        noTranscript++;
      }
    } catch (e) {
      console.log(`✗ 오류: ${e.message?.slice(0, 60)}`);
      failed++;
    }
    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ 완료: ${done}개 처리, ${noTranscript}개 자막없음, ${failed}개 실패`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
