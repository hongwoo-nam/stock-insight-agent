import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/db/client";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
