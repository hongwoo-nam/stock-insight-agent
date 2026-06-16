import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_ANON_KEY!;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
    client = createClient(url, key);
  }
  return client;
}
