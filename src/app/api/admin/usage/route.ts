import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";
import { getSupabase } from "@/lib/db/client";

async function getOpenAIUsage() {
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: totalRows } = await supabase
    .from("api_usage")
    .select("input_tokens, output_tokens, cost_usd, type");

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

async function getClaudeCodeUsage() {
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: allRows } = await supabase
    .from("claude_usage")
    .select("date, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd");

  if (!allRows || allRows.length === 0) return null;

  const sum = (rows: typeof allRows) => {
    const r = { input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
    for (const row of rows ?? []) {
      r.input_tokens       += Number(row.input_tokens ?? 0);
      r.output_tokens      += Number(row.output_tokens ?? 0);
      r.cache_write_tokens += Number(row.cache_write_tokens ?? 0);
      r.cache_read_tokens  += Number(row.cache_read_tokens ?? 0);
      r.cost_usd           += Number(row.cost_usd ?? 0);
    }
    return r;
  };

  const todayRows = allRows.filter(r => r.date === today);

  return {
    total: sum(allRows),
    today: sum(todayRows),
    last_synced: allRows.reduce((latest, r) => r.date > latest ? r.date : latest, ""),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  const [openai, claude] = await Promise.all([getOpenAIUsage(), getClaudeCodeUsage()]);

  return NextResponse.json({ openai, claude });
}
