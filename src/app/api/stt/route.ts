import { NextRequest, NextResponse } from "next/server";
import { speechToText } from "@/lib/voice/elevenlabs";
import { getSetting } from "@/lib/db/settings";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) return NextResponse.json({ error: "Audio file required" }, { status: 400 });

    const apiKey = await getSetting("elevenlabs_api_key");
    if (!apiKey) return NextResponse.json({ error: "ElevenLabs API key not configured" }, { status: 503 });

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = await speechToText(buffer, apiKey);

    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "STT failed" }, { status: 500 });
  }
}
