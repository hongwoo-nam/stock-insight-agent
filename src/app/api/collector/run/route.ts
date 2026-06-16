import { NextRequest, NextResponse } from "next/server";
import { runCollector } from "@/lib/agents/collector";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (isNextResponse(auth)) return auth;

  try {
    const result = await runCollector();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Collector failed" }, { status: 500 });
  }
}
