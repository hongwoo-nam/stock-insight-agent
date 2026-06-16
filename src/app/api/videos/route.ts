import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    const videos = await query(
      `SELECT v.*, COUNT(tc.id)::int AS chunk_count
       FROM videos v
       LEFT JOIN transcript_chunks tc ON tc.video_id = v.video_id
       GROUP BY v.id
       ORDER BY v.published_at DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const [{ count }] = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM videos"
    );

    return NextResponse.json({ videos, total: parseInt(count), page, limit });
  } catch (err) {
    console.error("Videos error:", err);
    return NextResponse.json({ error: "Failed to fetch videos" }, { status: 500 });
  }
}
