import { NextResponse } from "next/server";
import { query } from "@/lib/db/client";

export async function GET() {
  try {
    const logs = await query(
      `SELECT * FROM collection_logs ORDER BY created_at DESC LIMIT 10`
    );
    const [stats] = await query<{
      total_videos: string;
      done_videos: string;
      total_chunks: string;
    }>(
      `SELECT
         COUNT(DISTINCT v.id)::text AS total_videos,
         COUNT(DISTINCT CASE WHEN v.transcript_status = 'done' THEN v.id END)::text AS done_videos,
         COUNT(tc.id)::text AS total_chunks
       FROM videos v
       LEFT JOIN transcript_chunks tc ON tc.video_id = v.video_id`
    );
    return NextResponse.json({ logs, stats });
  } catch (err) {
    console.error("Collector status error:", err);
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}
