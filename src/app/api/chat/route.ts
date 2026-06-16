import { NextRequest, NextResponse } from "next/server";
import { runOrchestrator } from "@/lib/agents/orchestrator";
import { getSetting } from "@/lib/db/settings";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";

const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_ITEMS = 10;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  try {
    const { message, history = [] } = await req.json();

    if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });
    if (message.length > MAX_MESSAGE_LENGTH) return NextResponse.json({ error: `메시지는 ${MAX_MESSAGE_LENGTH}자 이하로 입력해주세요.` }, { status: 400 });

    const safeHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_ITEMS) : [];

    const apiKey = await getSetting("openai_api_key");
    if (!apiKey) return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 503 });

    const result = await runOrchestrator(message, apiKey, safeHistory);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
