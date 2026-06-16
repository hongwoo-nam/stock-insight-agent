#!/usr/bin/env node
/**
 * RAG 검색 테스트 스크립트
 * 실행: node scripts/test-rag.mjs
 * 필요: .env.local 에 SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY 설정
 */

import { createClient } from "@supabase/supabase-js";
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

const { SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !OPENAI_API_KEY) {
  console.error("❌ 환경변수 누락: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY 필요");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function testRAG(question) {
  console.log(`\n${"=".repeat(55)}`);
  console.log(`❓ ${question}`);

  const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: question });
  const { data: chunks, error } = await supabase.rpc("search_chunks", {
    query_embedding: JSON.stringify(embRes.data[0].embedding),
    match_count: 5,
  });

  if (error) { console.log("❌ 검색 오류:", error.message); return; }
  console.log(`📚 검색 결과 ${chunks?.length}개 | 최고 유사도: ${chunks?.[0]?.similarity?.toFixed(3)}`);
  chunks?.slice(0, 2).forEach((c, i) =>
    console.log(`  [${i + 1}] ${c.title?.slice(0, 40)} | ${c.chunk_text?.slice(0, 70)}...`)
  );

  const context = chunks.map((c, i) => `[출처${i + 1}: ${c.title}]\n${c.chunk_text}`).join("\n\n");
  const res = await openai.chat.completions.create({
    model: "gpt-4o", max_tokens: 400,
    messages: [
      { role: "system", content: "슈카월드 YouTube 영상 내용 기반 주식/경제 AI입니다. 출처 내용만 사용해 답변하고 투자 면책조항을 포함하세요." },
      { role: "user", content: `출처:\n${context}\n\n질문: ${question}` },
    ],
  });
  console.log(`\n💬 ${res.choices[0].message.content}\n`);
}

const TESTS = [
  "카카오 주식 지금 살만한가요?",
  "스페이스X IPO 어떻게 봐야 하나요?",
  "삼성전자 주식 전망은 어떤가요?",
];

(async () => {
  const { count } = await supabase.from("transcript_chunks").select("*", { count: "exact", head: true });
  console.log(`📊 저장된 청크 수: ${count}\n`);
  for (const q of TESTS) {
    await testRAG(q);
    await new Promise(r => setTimeout(r, 1000));
  }
})().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
