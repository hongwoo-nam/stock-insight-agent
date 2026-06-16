import { getSupabase } from "./client";
import { Settings } from "@/types";

export async function getSetting(key: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function getAllSettings(): Promise<Settings> {
  const supabase = getSupabase();
  const { data } = await supabase.from("settings").select("key, value");
  const map: Record<string, string> = {};
  for (const row of data || []) {
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
