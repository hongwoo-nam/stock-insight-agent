/**
 * 로컬 ~/.claude JSONL 파일을 파싱해서 Supabase claude_usage 테이블에 동기화합니다.
 * 사용: node scripts/sync-claude-usage.mjs
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import readline from "readline";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// .env.local 로드
const require = createRequire(import.meta.url);
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Claude Sonnet 4.6 요금 (USD / 1M tokens)
const PRICING = { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 };
const calcCost = (inp, out, cw, cr) =>
  (inp * PRICING.input + out * PRICING.output +
   cw  * PRICING.cacheWrite + cr * PRICING.cacheRead) / 1_000_000;

async function parseClaudeUsage() {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) {
    console.error("❌ ~/.claude/projects 디렉토리가 없습니다.");
    process.exit(1);
  }

  // date → { input, output, cacheWrite, cacheRead }
  const byDate = {};

  const dirs = fs.readdirSync(projectsDir);
  for (const dir of dirs) {
    const dirPath = path.join(projectsDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".jsonl"));

    for (const file of files) {
      const rl = readline.createInterface({
        input: fs.createReadStream(path.join(dirPath, file)),
        crlfDelay: Infinity,
      });

      await new Promise(resolve => {
        rl.on("line", line => {
          try {
            const d = JSON.parse(line);
            const usage = d?.message?.usage;
            if (!usage) return;

            const date = d.timestamp
              ? new Date(d.timestamp).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10);

            if (!byDate[date]) byDate[date] = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
            byDate[date].input      += usage.input_tokens ?? 0;
            byDate[date].output     += usage.output_tokens ?? 0;
            byDate[date].cacheWrite += usage.cache_creation_input_tokens ?? 0;
            byDate[date].cacheRead  += usage.cache_read_input_tokens ?? 0;
          } catch { /* ignore */ }
        });
        rl.on("close", resolve);
      });
    }
  }

  return byDate;
}

async function main() {
  console.log("📊 ~/.claude 사용량 파싱 중...");
  const byDate = await parseClaudeUsage();
  const dates = Object.keys(byDate).sort();

  if (dates.length === 0) {
    console.log("⚠️  파싱된 데이터가 없습니다.");
    return;
  }

  console.log(`📅 ${dates.length}개 날짜 데이터 발견 (${dates[0]} ~ ${dates[dates.length - 1]})`);

  const rows = dates.map(date => {
    const d = byDate[date];
    return {
      date,
      input_tokens:       d.input,
      output_tokens:      d.output,
      cache_write_tokens: d.cacheWrite,
      cache_read_tokens:  d.cacheRead,
      cost_usd:           calcCost(d.input, d.output, d.cacheWrite, d.cacheRead),
      synced_at:          new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("claude_usage")
    .upsert(rows, { onConflict: "date" });

  if (error) {
    console.error("❌ Supabase upsert 실패:", error.message);
    process.exit(1);
  }

  const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const totalInput = rows.reduce((s, r) => s + r.input_tokens, 0);
  const totalOutput = rows.reduce((s, r) => s + r.output_tokens, 0);

  console.log("✅ 동기화 완료!");
  console.log(`   입력 토큰: ${totalInput.toLocaleString()}`);
  console.log(`   출력 토큰: ${totalOutput.toLocaleString()}`);
  console.log(`   추정 비용: $${totalCost.toFixed(4)}`);
  console.log("   (Claude Code는 구독 기반이므로 비용은 참고용입니다)");
}

main().catch(e => { console.error(e); process.exit(1); });
