import { NextResponse } from "next/server";
import { runCollector } from "@/lib/agents/collector";

export async function POST() {
  try {
    const result = await runCollector();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Collector error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
