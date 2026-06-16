import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";
import { getSupabase } from "@/lib/db/client";
import fs from "fs";
import path from "path";
import readline from "readline";
import os from "os";

// Claude Sonnet 4.6 pricing (USD per 1M tokens)
const CLAUDE_PRICING = {
  input:        3.00,
  output:       15.00,
  cacheWrite:   3.75,
  cacheRead:    0.30,
};

async function getClaudeCodeUsage() {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return null;

  let totalInput = 0, totalOutput = 0, totalCacheWrite = 0, totalCacheRead = 0;
  let todayInput = 0, todayOutput = 0, todayCacheWrite = 0, todayCacheRead = 0;
  const today = new Date().toISOString().slice(0, 10);

  const dirs = fs.readdirSync(projectsDir);
  for (const dir of dirs) {
    const dirPath = path.join(projectsDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".jsonl"));

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });

      await new Promise<void>(resolve => {
        rl.on("line", line => {
          try {
            const d = JSON.parse(line);
            const usage = d?.message?.usage;
            if (!usage) return;

            const inp  = (usage.input_tokens ?? 0);
            const out  = (usage.output_tokens ?? 0);
            const cw   = (usage.cache_creation_input_tokens ?? 0);
            const cr   = (usage.cache_read_input_tokens ?? 0);

            totalInput      += inp;
            totalOutput     += out;
            totalCacheWrite += cw;
            totalCacheRead  += cr;

            const ts = d.timestamp ? new Date(d.timestamp).toISOString().slice(0, 10) : "";
            if (ts === today) {
              todayInput      += inp;
              todayOutput     += out;
              todayCacheWrite += cw;
              todayCacheRead  += cr;
            }
          } catch { /* ignore */ }
        });
        rl.on("close", resolve);
      });
    }
  }

  const calcCost = (inp: number, out: number, cw: number, cr: number) =>
    (inp * CLAUDE_PRICING.input + out * CLAUDE_PRICING.output +
     cw  * CLAUDE_PRICING.cacheWrite + cr * CLAUDE_PRICING.cacheRead) / 1_000_000;

  return {
    total: {
      input_tokens: totalInput, output_tokens: totalOutput,
      cache_write_tokens: totalCacheWrite, cache_read_tokens: totalCacheRead,
      cost_usd: calcCost(totalInput, totalOutput, totalCacheWrite, totalCacheRead),
    },
    today: {
      input_tokens: todayInput, output_tokens: todayOutput,
      cache_write_tokens: todayCacheWrite, cache_read_tokens: todayCacheRead,
      cost_usd: calcCost(todayInput, todayOutput, todayCacheWrite, todayCacheRead),
    },
  };
}

async function getOpenAIUsage() {
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  // 전체 합계
  const { data: totalRows } = await supabase
    .from("api_usage")
    .select("input_tokens, output_tokens, cost_usd, type");

  // 오늘 합계
  const { data: todayRows } = await supabase
    .from("api_usage")
    .select("input_tokens, output_tokens, cost_usd, type")
    .gte("called_at", `${today}T00:00:00Z`);

  const sum = (rows: typeof totalRows) => {
    const r = { input_tokens: 0, output_tokens: 0, cost_usd: 0, chat_calls: 0, embedding_calls: 0 };
    for (const row of rows ?? []) {
      r.input_tokens  += row.input_tokens  ?? 0;
      r.output_tokens += row.output_tokens ?? 0;
      r.cost_usd      += Number(row.cost_usd ?? 0);
      if (row.type === "chat")      r.chat_calls++;
      if (row.type === "embedding") r.embedding_calls++;
    }
    return r;
  };

  return { total: sum(totalRows), today: sum(todayRows) };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  const [openai, claude] = await Promise.all([getOpenAIUsage(), getClaudeCodeUsage()]);

  return NextResponse.json({ openai, claude });
}
