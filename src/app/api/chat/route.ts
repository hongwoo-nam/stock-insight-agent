import { NextRequest, NextResponse } from "next/server";
import { runOrchestrator } from "@/lib/agents/orchestrator";
import { getSetting } from "@/lib/db/settings";

export async function POST(req: NextRequest) {
  try {
    const { message, history = [] } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    const apiKey = await getSetting("openai_api_key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured. Please visit Admin Settings." },
        { status: 503 }
      );
    }

    const result = await runOrchestrator(message, apiKey, history);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
