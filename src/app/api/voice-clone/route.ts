import { NextRequest, NextResponse } from "next/server";
import { cloneVoice } from "@/lib/voice/elevenlabs";
import { getSetting, setSetting } from "@/lib/db/settings";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;
    const name = formData.get("name") as string;
    const consent = formData.get("consent") === "true";

    if (!audioFile || !name) {
      return NextResponse.json({ error: "Audio and name required" }, { status: 400 });
    }
    if (!consent) {
      return NextResponse.json({ error: "Consent required" }, { status: 400 });
    }

    const apiKey = await getSetting("elevenlabs_api_key");
    if (!apiKey) {
      return NextResponse.json({ error: "ElevenLabs API key not configured" }, { status: 503 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const voiceId = await cloneVoice(name, buffer, apiKey);

    await setSetting("cloned_voice_id", voiceId);
    await setSetting("cloned_voice_name", name);

    return NextResponse.json({ voice_id: voiceId, name });
  } catch (err) {
    console.error("Voice clone error:", err);
    return NextResponse.json({ error: "Voice cloning failed" }, { status: 500 });
  }
}

export async function DELETE() {
  await setSetting("cloned_voice_id", "");
  await setSetting("cloned_voice_name", "");
  return NextResponse.json({ success: true });
}
