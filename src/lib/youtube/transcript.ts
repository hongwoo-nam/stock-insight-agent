export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": "https://www.youtube.com/",
};

async function getCaptionUrl(videoId: string): Promise<string | null> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();

  // Extract captions data from page
  const captionsMatch = html.match(/"captionTracks":(\[.*?\])/);
  if (!captionsMatch) return null;

  try {
    const tracks = JSON.parse(captionsMatch[1]);
    // Prefer Korean, fallback to any
    const korean = tracks.find((t: { languageCode: string }) => t.languageCode === "ko");
    const auto = tracks.find((t: { kind?: string }) => t.kind === "asr");
    const any = tracks[0];
    const track = korean || auto || any;
    return track?.baseUrl ?? null;
  } catch {
    return null;
  }
}

function parseTimedText(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const matches = [...xml.matchAll(/<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)];

  for (const match of matches) {
    const text = match[3]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!text) continue;
    segments.push({
      text,
      offset: parseFloat(match[1]),
      duration: parseFloat(match[2]),
    });
  }

  return segments;
}

export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const captionUrl = await getCaptionUrl(videoId);
  if (!captionUrl) throw new Error("No transcript available");

  const res = await fetch(captionUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch transcript: ${res.status}`);

  const xml = await res.text();
  const segments = parseTimedText(xml);

  if (!segments.length) throw new Error("Empty transcript");
  return segments;
}
