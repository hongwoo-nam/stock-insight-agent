import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";
import { getSupabase } from "@/lib/db/client";

// 청크당 평균 저장 크기 추정 (embedding 1536*4B + text ~1KB + overhead)
const CHUNK_SIZE_KB = 8;
const VIDEO_SIZE_KB = 2;

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

async function getVercelUsage() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = "prj_YnVf5n6UJbQNKvwGXduMIii65d76";
  const teamId = "team_JR5c4q1vXkkaeeQ5AN5jVUxa";
  if (!token) return null;

  const headers = { Authorization: `Bearer ${token}` };

  try {
    const [projectRes, deploymentsRes, teamRes] = await Promise.all([
      fetch(`https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`, { headers }),
      fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&teamId=${teamId}&limit=5&target=production`, { headers }),
      fetch(`https://api.vercel.com/v2/teams/${teamId}`, { headers }),
    ]);

    const [project, deploymentsData, team] = await Promise.all([
      projectRes.json(),
      deploymentsRes.json(),
      teamRes.json(),
    ]);

    const deployments = deploymentsData.deployments ?? [];
    const latest = deployments[0];

    // 이번 달 배포 수
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const monthlyCount = deployments.filter(
      (d: { createdAt: number }) => d.createdAt >= monthStart.getTime()
    ).length;

    return {
      plan: team.plan ?? "unknown",
      projectName: project.name ?? "stock-insight-agent",
      latestDeployment: latest ? {
        state: latest.state,
        createdAt: new Date(latest.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
        url: latest.url ? `https://${latest.url}` : null,
      } : null,
      monthlyDeployments: monthlyCount,
    };
  } catch {
    return null;
  }
}

async function getDbUsage() {
  const supabase = getSupabase();

  const [
    { count: videoCount },
    { count: chunkCount },
    { count: memberCount },
    { count: apiUsageCount },
  ] = await Promise.all([
    supabase.from("videos").select("*", { count: "exact", head: true }),
    supabase.from("transcript_chunks").select("*", { count: "exact", head: true }),
    supabase.from("members").select("*", { count: "exact", head: true }),
    supabase.from("api_usage").select("*", { count: "exact", head: true }),
  ]);

  const videos   = videoCount  ?? 0;
  const chunks   = chunkCount  ?? 0;
  const members  = memberCount ?? 0;
  const apiLogs  = apiUsageCount ?? 0;

  // 추정 저장 용량 (KB)
  const estimatedKB = chunks * CHUNK_SIZE_KB + videos * VIDEO_SIZE_KB + (members + apiLogs) * 1;

  return {
    videos,
    chunks,
    members,
    api_logs: apiLogs,
    estimated_mb: Math.round(estimatedKB / 1024 * 10) / 10,
    // Supabase free tier: 500MB
    free_tier_mb: 500,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  const [openai, db, vercel] = await Promise.all([
    getOpenAIUsage(),
    getDbUsage(),
    getVercelUsage(),
  ]);

  return NextResponse.json({ openai, db, vercel });
}
