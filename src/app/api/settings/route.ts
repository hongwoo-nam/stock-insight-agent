import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db/settings";

export async function GET() {
  try {
    const settings = await getAllSettings();
    // Mask API keys
    const masked = { ...settings };
    if (masked.openai_api_key) {
      masked.openai_api_key = "sk-..." + masked.openai_api_key.slice(-4);
    }
    if (masked.elevenlabs_api_key) {
      masked.elevenlabs_api_key = "***" + masked.elevenlabs_api_key.slice(-4);
    }
    return NextResponse.json(masked);
  } catch (err) {
    console.error("Settings GET error:", err);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const allowedKeys = [
      "openai_api_key",
      "elevenlabs_api_key",
      "youtube_api_key",
      "male_voice_id",
      "female_voice_id",
      "default_voice",
      "collection_schedule",
    ];

    for (const key of allowedKeys) {
      if (body[key] !== undefined && body[key] !== "") {
        await setSetting(key, body[key]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Settings POST error:", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
