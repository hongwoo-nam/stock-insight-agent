"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface Stats {
  total_videos: string;
  done_videos: string;
  total_chunks: string;
}

interface RecentVideo {
  video_id: string;
  title: string;
  url: string;
  published_at: string;
  transcript_status: string;
}

interface StockNews {
  stock: string;
  question: string;
  videoTitle: string;
  videoUrl: string;
  publishedAt: string;
}

const STOCK_COLORS: Record<string, string> = {
  "HLB": "bg-red-50 text-red-700 border-red-100",
  "삼성전자": "bg-blue-50 text-blue-700 border-blue-100",
  "SK하이닉스": "bg-purple-50 text-purple-700 border-purple-100",
  "셀트리온": "bg-green-50 text-green-700 border-green-100",
  "네이버": "bg-emerald-50 text-emerald-700 border-emerald-100",
};

const KEY_TOPICS = [
  "금리", "환율", "반도체", "삼성전자", "코스피", "나스닥",
  "인플레이션", "경기침체", "부동산", "배터리", "AI 반도체",
];

export function DashboardContent() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentVideos, setRecentVideos] = useState<RecentVideo[]>([]);
  const [stockNews, setStockNews] = useState<StockNews[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/collector/status")
      .then((r) => r.json())
      .then((d) => setStats(d.stats))
      .catch(() => {});

    fetch("/api/videos?limit=5")
      .then((r) => r.json())
      .then((d) => setRecentVideos(d.videos || []))
      .catch(() => {});

    fetch("/api/stocks/news")
      .then((r) => r.json())
      .then((d) => setStockNews(d.news || []))
      .catch(() => {})
      .finally(() => setNewsLoading(false));
  }, []);

  return (
    <main className="max-w-7xl mx-auto px-6 py-10">
      {/* Hero */}
      <div className="mb-12">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">Live Intelligence</span>
        </div>
        <h1 className="text-4xl font-bold text-gray-900 leading-tight mb-4">
          슈카월드 기반<br />
          <span className="text-gray-400">주식·경제 인사이트</span>
        </h1>
        <p className="text-gray-500 text-lg max-w-lg">
          AI가 슈카월드 전체 영상을 분석하여 시장 흐름과 투자 정보를 제공합니다.
          아래 버튼으로 Agent와 대화하세요.
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { label: "수집 영상", value: stats.total_videos, suffix: "개" },
            { label: "분석 완료", value: stats.done_videos, suffix: "개" },
            { label: "지식 청크", value: parseInt(stats.total_chunks).toLocaleString(), suffix: "개" },
          ].map((s) => (
            <Card key={s.label} className="border-gray-100">
              <CardContent className="p-5">
                <p className="text-xs text-gray-400 font-medium mb-1">{s.label}</p>
                <p className="text-2xl font-bold text-gray-900">
                  {s.value}
                  <span className="text-sm font-normal text-gray-400 ml-1">{s.suffix}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Stock News Questions */}
        <div className="col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">오늘의 종목 소식</CardTitle>
              <span className="text-xs text-gray-400">클릭하면 AI에게 바로 질문합니다</span>
            </CardHeader>
            <CardContent className="space-y-2">
              {newsLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : stockNews.map((item, i) => (
                <button
                  key={i}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-all group"
                  onClick={() => {
                    const event = new CustomEvent("openChatWithMessage", { detail: item.question });
                    window.dispatchEvent(event);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold border ${STOCK_COLORS[item.stock] ?? "bg-gray-50 text-gray-600 border-gray-100"}`}>
                        {item.stock}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 group-hover:text-gray-900 font-medium leading-snug">
                          {item.question}
                        </p>
                        {item.videoTitle && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">
                            📹 {item.videoTitle}
                          </p>
                        )}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Key Topics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">주요 키워드</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {KEY_TOPICS.map((topic) => (
                  <Badge key={topic} variant="secondary" className="cursor-pointer hover:bg-gray-200 text-xs">
                    {topic}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Videos */}
          {recentVideos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">최근 수집 영상</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentVideos.map((v) => (
                  <a
                    key={v.video_id}
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group"
                  >
                    <p className="text-xs font-medium text-gray-800 line-clamp-2 group-hover:text-blue-700 transition-colors">
                      {v.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400">
                        {v.published_at ? formatDate(v.published_at) : "날짜 없음"}
                      </span>
                      <Badge
                        variant={v.transcript_status === "done" ? "success" : "secondary"}
                        className="text-xs"
                      >
                        {v.transcript_status === "done" ? "완료" : v.transcript_status}
                      </Badge>
                    </div>
                  </a>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Info card */}
          <Card className="bg-gray-50 border-gray-100">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                <span className="font-medium text-gray-700">투자 주의사항</span><br />
                본 서비스는 슈카월드 영상 기반 정보 제공 서비스이며, 투자 조언이 아닙니다.
                투자 판단 및 책임은 전적으로 본인에게 있습니다.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
