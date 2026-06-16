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

const FEATURED_QUESTIONS = [
  "삼성전자 지금 전망이 어떤가요?",
  "미국 금리 인하 시기가 언제인가요?",
  "반도체 사이클 현재 어디에 있나요?",
  "환율 1400원대 전망은?",
  "코스피 하반기 전망을 알려주세요",
];

const KEY_TOPICS = [
  "금리", "환율", "반도체", "삼성전자", "코스피", "나스닥",
  "인플레이션", "경기침체", "부동산", "배터리", "AI 반도체",
];

export function DashboardContent() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentVideos, setRecentVideos] = useState<RecentVideo[]>([]);

  useEffect(() => {
    fetch("/api/collector/status")
      .then((r) => r.json())
      .then((d) => setStats(d.stats))
      .catch(() => {});

    fetch("/api/videos?limit=5")
      .then((r) => r.json())
      .then((d) => setRecentVideos(d.videos || []))
      .catch(() => {});
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
        {/* Featured Questions */}
        <div className="col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">오늘의 추천 질문</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {FEATURED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-all group flex items-center justify-between"
                  onClick={() => {
                    const event = new CustomEvent("openChatWithMessage", { detail: q });
                    window.dispatchEvent(event);
                  }}
                >
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{q}</span>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
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
