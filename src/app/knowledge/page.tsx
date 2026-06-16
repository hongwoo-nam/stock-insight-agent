"use client";

import { useEffect, useState } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Video } from "@/types";
import { formatDate } from "@/lib/utils";

interface CollectionStatus {
  stats: {
    total_videos: string;
    done_videos: string;
    total_chunks: string;
  };
  logs: Array<{
    id: number;
    job_date: string;
    status: string;
    new_video_count: number;
    error_message?: string;
    created_at: string;
  }>;
}

export default function KnowledgePage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{
    title: string;
    url: string;
    chunk_text: string;
    start_time: number;
    similarity: number;
  }> | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    loadData();
  }, [page]);

  const loadData = async () => {
    const [videosRes, statusRes] = await Promise.all([
      fetch(`/api/videos?page=${page}&limit=20`).then((r) => r.json()).catch(() => ({ videos: [], total: 0 })),
      fetch("/api/collector/status").then((r) => r.json()).catch(() => null),
    ]);
    setVideos(videosRes.videos || []);
    setTotal(videosRes.total || 0);
    setStatus(statusRes);
  };

  const handleCollect = async () => {
    setCollecting(true);
    try {
      await fetch("/api/collector/run", { method: "POST" });
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setCollecting(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/rag/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, topK: 5 }),
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } finally {
      setSearching(false);
    }
  };

  const statusColor: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
    done: "success",
    processing: "secondary",
    failed: "destructive",
    pending: "outline",
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">지식베이스</h1>
            <p className="text-gray-500 text-sm mt-1">슈카월드 영상 수집 및 RAG 상태</p>
          </div>
          <Button onClick={handleCollect} disabled={collecting}>
            {collecting ? "수집 중..." : "수동 수집 실행"}
          </Button>
        </div>

        {/* Stats */}
        {status?.stats && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: "전체 영상", value: status.stats.total_videos },
              { label: "분석 완료", value: status.stats.done_videos },
              { label: "지식 청크", value: parseInt(status.stats.total_chunks).toLocaleString() },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-5">
                  <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* RAG Search Test */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">RAG 검색 테스트</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 mb-4">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="검색어를 입력하세요..."
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={searching}>
                {searching ? "검색 중..." : "검색"}
              </Button>
            </div>
            {searchResults && (
              <div className="space-y-3">
                {searchResults.length === 0 ? (
                  <p className="text-sm text-gray-400">검색 결과가 없습니다.</p>
                ) : (
                  searchResults.map((r, i) => (
                    <div key={i} className="p-4 rounded-lg border border-gray-100 bg-gray-50">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <a href={r.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium text-blue-700 hover:underline line-clamp-1">
                          {r.title}
                        </a>
                        <Badge variant="secondary">{(r.similarity * 100).toFixed(0)}%</Badge>
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-3">{r.chunk_text}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Video list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">수집 영상 목록 ({total}개)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {videos.map((v) => (
                <div key={v.video_id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <a href={v.url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-gray-900 hover:text-blue-700 line-clamp-1">
                      {v.title}
                    </a>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {v.published_at ? formatDate(v.published_at) : "날짜 없음"}
                      {v.chunk_count !== undefined && ` · 청크 ${v.chunk_count}개`}
                    </p>
                  </div>
                  <Badge variant={statusColor[v.transcript_status] || "outline"}>
                    {v.transcript_status}
                  </Badge>
                </div>
              ))}
            </div>

            {total > 20 && (
              <div className="flex justify-center gap-2 mt-6">
                <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
                  이전
                </Button>
                <span className="text-sm text-gray-500 self-center">
                  {page} / {Math.ceil(total / 20)}
                </span>
                <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(total / 20)}>
                  다음
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
