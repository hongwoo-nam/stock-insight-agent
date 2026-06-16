import { NextResponse } from "next/server";

export async function GET() {
  const videoId = "LsueMR5CGno";
  const results: Record<string, unknown> = {};

  // Test 1: YouTube page fetch
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });
    const html = await res.text();
    const hasCaptions = html.includes("captionTracks");
    const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
    results.page_status = res.status;
    results.has_captions = hasCaptions;
    results.caption_tracks = captionMatch ? JSON.parse(captionMatch[1]).map((t: { languageCode: string; kind?: string }) => ({ lang: t.languageCode, kind: t.kind })) : null;
  } catch (e) {
    results.page_error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(results);
}
