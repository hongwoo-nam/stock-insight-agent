import { query } from "./client";
import { Settings } from "@/types";

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

export async function getAllSettings(): Promise<Settings> {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM settings"
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return {
    openai_api_key: map["openai_api_key"],
    elevenlabs_api_key: map["elevenlabs_api_key"],
    male_voice_id: map["male_voice_id"],
    female_voice_id: map["female_voice_id"],
    default_voice: (map["default_voice"] as "male" | "female") || "male",
    collection_schedule: map["collection_schedule"] || "0 18 * * *",
  };
}
