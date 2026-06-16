import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db/client";

const TOPICS = [
  { name: "HLB",      keywords: ["HLB", "에이치엘비"],              searchKw: "HLB 주식" },
  { name: "삼성전자",  keywords: ["삼성전자"],                        searchKw: "삼성전자 주식" },
  { name: "SK하이닉스", keywords: ["SK하이닉스", "하이닉스"],          searchKw: "SK하이닉스 주식" },
  { name: "셀트리온",  keywords: ["셀트리온"],                        searchKw: "셀트리온 주식" },
  { name: "네이버",    keywords: ["네이버", "NAVER"],                 searchKw: "네이버 주식" },
  { name: "금리",      keywords: ["금리인상", "금리 인상", "기준금리"], searchKw: "금리인상" },
  { name: "미이란",    keywords: ["이란", "미국 이란", "중동 전쟁"],   searchKw: "미국 이란 전쟁" },
];

function makeQuestion(topicName: string, title: string): string {
  const cleaned = title
    .replace(/\[.*?\]/g, "")
    .replace(/주가전망|주가 전망|주식투자|주식 투자|주가 분석/g, "")
    .replace(/긴급속보|긴급|속보|단독|실시간|🔥|🚨|💥|⚡|👉|✅|❌|⚠️/g, "")
    .replace(/#\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 40);

  return `${topicName} ${cleaned ? `— ${cleaned}` : "최신 소식이 어떤가요?"}`;
}

export async function GET() {
  const supabase = getSupabase();
  const result: { stock: string; question: string; videoTitle: string; videoUrl: string; publishedAt: string }[] = [];

  for (const topic of TOPICS) {
    let video = null;

    // 제목 키워드 매칭
    for (const kw of topic.keywords) {
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

    // channel_name으로 fallback (수집 시 channel_name에 키워드가 들어있을 수도 있음)
    if (!video) {
      const { data } = await supabase
        .from("videos")
        .select("title, url, published_at")
        .eq("transcript_status", "done")
        .ilike("channel_name", `%${topic.searchKw}%`)
        .order("published_at", { ascending: false })
        .limit(1)
        .single();
      if (data) video = data;
    }

    result.push(
      video
        ? {
            stock: topic.name,
            question: makeQuestion(topic.name, video.title),
            videoTitle: video.title,
            videoUrl: video.url,
            publishedAt: video.published_at,
          }
        : {
            stock: topic.name,
            question: `${topic.name} 최신 소식이 어떤가요?`,
            videoTitle: "",
            videoUrl: "",
            publishedAt: "",
          }
    );
  }

  return NextResponse.json({ news: result });
}
