import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db/client";

const STOCKS = [
  { name: "HLB", keywords: ["HLB", "에이치엘비"] },
  { name: "삼성전자", keywords: ["삼성전자"] },
  { name: "SK하이닉스", keywords: ["SK하이닉스", "하이닉스"] },
  { name: "셀트리온", keywords: ["셀트리온"] },
  { name: "네이버", keywords: ["네이버", "NAVER"] },
];

function makeQuestion(stockName: string, title: string): string {
  // 제목에서 종목명·불필요한 패턴 제거
  const cleaned = title
    .replace(/\[.*?\]/g, "")
    .replace(/주가전망|주가 전망|주식투자|주식 투자|주가 분석/g, "")
    .replace(/긴급속보|긴급|속보|단독|실시간|🔥|🚨|💥|⚡|👉|✅|❌|⚠️/g, "")
    .replace(/#\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 40);

  return `${stockName} ${cleaned ? `— ${cleaned}` : "최신 소식이 어떤가요?"}`;
}

export async function GET() {
  const supabase = getSupabase();
  const result: { stock: string; question: string; videoTitle: string; videoUrl: string; publishedAt: string }[] = [];

  for (const stock of STOCKS) {
    // 종목 키워드가 포함된 가장 최근 done 영상 조회
    let video = null;
    for (const kw of stock.keywords) {
      const { data } = await supabase
        .from("videos")
        .select("title, url, published_at")
        .eq("transcript_status", "done")
        .ilike("title", `%${kw}%`)
        .order("published_at", { ascending: false })
        .limit(1)
        .single();
      if (data) { video = data; break; }
    }

    if (video) {
      result.push({
        stock: stock.name,
        question: makeQuestion(stock.name, video.title),
        videoTitle: video.title,
        videoUrl: video.url,
        publishedAt: video.published_at,
      });
    } else {
      // 수집된 영상이 없으면 기본 질문
      result.push({
        stock: stock.name,
        question: `${stock.name} 최신 소식이 어떤가요?`,
        videoTitle: "",
        videoUrl: "",
        publishedAt: "",
      });
    }
  }

  return NextResponse.json({ news: result });
}
