import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db/client";

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data: logs } = await supabase
      .from("collection_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    const { count: totalVideos } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true });

    const { count: doneVideos } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .eq("transcript_status", "done");

    const { count: totalChunks } = await supabase
      .from("transcript_chunks")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      logs: logs || [],
      stats: {
        total_videos: String(totalVideos || 0),
        done_videos: String(doneVideos || 0),
        total_chunks: String(totalChunks || 0),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
