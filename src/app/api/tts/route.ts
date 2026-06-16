import { NextRequest, NextResponse } from "next/server";
import { textToSpeech } from "@/lib/voice/elevenlabs";
import { getSetting } from "@/lib/db/settings";

export async function POST(req: NextRequest) {
  try {
    const { text, voiceType = "male" } = await req.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: "Text required" }, { status: 400 });
    }

    const apiKey = await getSetting("elevenlabs_api_key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "ElevenLabs API key not configured" },
        { status: 503 }
      );
    }

    const voiceIdKey = voiceType === "female" ? "female_voice_id" : "male_voice_id";
    const voiceId = await getSetting(voiceIdKey);
    if (!voiceId) {
      return NextResponse.json(
        { error: `Voice ID not configured for ${voiceType}` },
        { status: 503 }
      );
    }

    const audioBuffer = await textToSpeech(text, voiceId, apiKey);

    return new NextResponse(new Uint8Array(audioBuffer), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("TTS error:", err);
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}
