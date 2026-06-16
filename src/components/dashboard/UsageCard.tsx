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

interface UsageData {
  openai: { total: UsageStat; today: UsageStat } | null;
  claude: { total: UsageStat; today: UsageStat } | null;
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
        <CardHeader><CardTitle className="text-sm">API 사용량</CardTitle></CardHeader>
        <CardContent><div className="h-20 bg-gray-100 rounded animate-pulse" /></CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          API 사용량 / 비용
          <div className="flex gap-3 text-right">
            <span className="text-xs text-gray-400 w-16 font-normal">오늘</span>
            <span className="text-xs text-gray-400 w-16 font-normal">누적</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">

        {/* OpenAI */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs font-semibold text-gray-700">OpenAI (이 앱)</span>
          </div>
          {data.openai ? (
            <div className="pl-3.5">
              <StatRow
                label="비용"
                today={fmtCost(data.openai.today.cost_usd)}
                total={fmtCost(data.openai.total.cost_usd)}
              />
              <StatRow
                label="입력 토큰"
                today={fmt(data.openai.today.input_tokens)}
                total={fmt(data.openai.total.input_tokens)}
              />
              <StatRow
                label="출력 토큰"
                today={fmt(data.openai.today.output_tokens)}
                total={fmt(data.openai.total.output_tokens)}
              />
              <StatRow
                label="채팅 호출"
                today={String(data.openai.today.chat_calls ?? 0)}
                total={String(data.openai.total.chat_calls ?? 0)}
              />
              <StatRow
                label="임베딩 호출"
                today={String(data.openai.today.embedding_calls ?? 0)}
                total={String(data.openai.total.embedding_calls ?? 0)}
              />
            </div>
          ) : (
            <p className="text-xs text-gray-400 pl-3.5">데이터 없음</p>
          )}
        </div>

        {/* Claude Code */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <span className="text-xs font-semibold text-gray-700">Claude Code (개발)</span>
          </div>
          {data.claude ? (
            <div className="pl-3.5">
              <StatRow
                label="비용 (추정)"
                today={fmtCost(data.claude.today.cost_usd)}
                total={fmtCost(data.claude.total.cost_usd)}
              />
              <StatRow
                label="입력 토큰"
                today={fmt(data.claude.today.input_tokens)}
                total={fmt(data.claude.total.input_tokens)}
              />
              <StatRow
                label="출력 토큰"
                today={fmt(data.claude.today.output_tokens)}
                total={fmt(data.claude.total.output_tokens)}
              />
              <StatRow
                label="캐시 읽기"
                today={fmt(data.claude.today.cache_read_tokens ?? 0)}
                total={fmt(data.claude.total.cache_read_tokens ?? 0)}
              />
            </div>
          ) : (
            <p className="text-xs text-gray-400 pl-3.5">~/.claude 데이터 없음</p>
          )}
        </div>

        <p className="text-xs text-gray-400">※ Claude Code는 구독 기반이며 비용은 참고용 추정치입니다.</p>
      </CardContent>
    </Card>
  );
}
