"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UsageStat {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  chat_calls?: number;
  embedding_calls?: number;
  cache_write_tokens?: number;
  cache_read_tokens?: number;
}

interface DbUsage {
  videos: number;
  chunks: number;
  members: number;
  api_logs: number;
  estimated_mb: number;
  free_tier_mb: number;
}

interface UsageData {
  openai: { total: UsageStat; today: UsageStat } | null;
  claude: { total: UsageStat; today: UsageStat; last_synced?: string } | null;
  db: DbUsage | null;
}

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtCost(usd: number) {
  if (usd < 0.001) return "< $0.001";
  return "$" + usd.toFixed(4);
}

function StatRow({ label, today, total }: { label: string; today: string; total: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex gap-3 text-right">
        <span className="text-xs text-gray-400 w-16">{today}</span>
        <span className="text-xs font-medium text-gray-700 w-16">{total}</span>
      </div>
    </div>
  );
}

function DbRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="text-right">
        <span className="text-xs font-medium text-gray-700">{value}</span>
        {sub && <span className="text-xs text-gray-400 ml-1">{sub}</span>}
      </div>
    </div>
  );
}

export function UsageCard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">API / DB 사용량</CardTitle></CardHeader>
        <CardContent><div className="h-24 bg-gray-100 rounded animate-pulse" /></CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const dbPct = data.db ? Math.min(100, Math.round((data.db.estimated_mb / data.db.free_tier_mb) * 100)) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          API / DB 사용량
          <div className="flex gap-3 text-right">
            <span className="text-xs text-gray-400 w-16 font-normal">오늘</span>
            <span className="text-xs text-gray-400 w-16 font-normal">누적</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">

        {/* DB 사용량 */}
        {data.db && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-xs font-semibold text-gray-700">Supabase DB</span>
            </div>
            <div className="pl-3.5">
              <DbRow label="수집 영상" value={`${data.db.videos.toLocaleString()}개`} />
              <DbRow label="청크 (벡터)" value={`${data.db.chunks.toLocaleString()}개`} />
              <DbRow label="API 로그" value={`${data.db.api_logs.toLocaleString()}건`} />
              <DbRow label="추정 저장용량" value={`${data.db.estimated_mb} MB`} sub={`/ ${data.db.free_tier_mb} MB`} />
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Free tier 사용률</span>
                  <span>{dbPct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${dbPct > 80 ? "bg-red-500" : dbPct > 50 ? "bg-yellow-500" : "bg-indigo-500"}`}
                    style={{ width: `${dbPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* OpenAI */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs font-semibold text-gray-700">OpenAI (이 앱)</span>
          </div>
          {data.openai ? (
            <div className="pl-3.5">
              <StatRow label="비용" today={fmtCost(data.openai.today.cost_usd)} total={fmtCost(data.openai.total.cost_usd)} />
              <StatRow label="입력 토큰" today={fmt(data.openai.today.input_tokens)} total={fmt(data.openai.total.input_tokens)} />
              <StatRow label="출력 토큰" today={fmt(data.openai.today.output_tokens)} total={fmt(data.openai.total.output_tokens)} />
              <StatRow label="채팅 / 임베딩" today={`${data.openai.today.chat_calls ?? 0}/${data.openai.today.embedding_calls ?? 0}`} total={`${data.openai.total.chat_calls ?? 0}/${data.openai.total.embedding_calls ?? 0}`} />
            </div>
          ) : (
            <p className="text-xs text-gray-400 pl-3.5">데이터 없음</p>
          )}
        </div>

        {/* Claude Code */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-xs font-semibold text-gray-700">Claude Code (개발)</span>
            </div>
            {data.claude?.last_synced && (
              <span className="text-xs text-gray-400">동기화: {data.claude.last_synced}</span>
            )}
          </div>
          {data.claude ? (
            <div className="pl-3.5">
              <StatRow label="비용 (추정)" today={fmtCost(data.claude.today.cost_usd)} total={fmtCost(data.claude.total.cost_usd)} />
              <StatRow label="입력 토큰" today={fmt(data.claude.today.input_tokens)} total={fmt(data.claude.total.input_tokens)} />
              <StatRow label="출력 토큰" today={fmt(data.claude.today.output_tokens)} total={fmt(data.claude.total.output_tokens)} />
              <StatRow label="캐시 읽기" today={fmt(data.claude.today.cache_read_tokens ?? 0)} total={fmt(data.claude.total.cache_read_tokens ?? 0)} />
            </div>
          ) : (
            <div className="pl-3.5">
              <p className="text-xs text-gray-400 mb-1">동기화된 데이터 없음</p>
              <p className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded">
                node scripts/sync-claude-usage.mjs
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">※ Claude Code 비용은 구독 기반 추정치 · DB 용량은 벡터 크기 기준 추정</p>
      </CardContent>
    </Card>
  );
}
