import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/db/client";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20")), MAX_LIMIT);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const supabase = getSupabase();
    const { data: videos, count, error } = await supabase
      .from("videos")
      .select("*", { count: "exact" })
      .order("published_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw new Error(error.message);

    return NextResponse.json({ videos: videos || [], total: count || 0, page, limit });
  } catch {
    return NextResponse.json({ error: "Failed to fetch videos" }, { status: 500 });
  }
}
