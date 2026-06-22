"use client";

import { useState, useRef, useEffect } from "react";

const DEFAULT_CHANNELS = [
  { handle: "@syukaworld", name: "슈카월드" },
  { handle: "@kvnews", name: "한국경제TV" },
];

const DEFAULT_KEYWORDS = [
  "HLB 주식",
  "삼성전자 주식",
  "SK하이닉스 주식",
  "셀트리온 주식",
  "네이버 주식",
  "금리인상",
  "미국 이란 전쟁",
];

type Mode = "channel" | "stock";
type Status = "idle" | "running" | "done" | "error";

interface FdaResult {
  source: string; url: string; found: boolean; approved: boolean | null;
  matchedKeywords: string[]; snippet: string; error?: string;
}

export default function CollectPage() {
  const [mode, setMode] = useState<Mode>("stock");
  const [keywordList, setKeywordList] = useState<string[]>(DEFAULT_KEYWORDS);
  const [newKeyword, setNewKeyword] = useState("");
  const [channels, setChannels] = useState(DEFAULT_CHANNELS.map(c => `${c.handle} ${c.name}`).join("\n"));
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stats, setStats] = useState<{ done: number; noTranscript: number; failed: number; totalChunks: number | null } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [fdaResults, setFdaResults] = useState<FdaResult[] | null>(null);
  const [fdaLoading, setFdaLoading] = useState(false);
  const [fdaSmsText, setFdaSmsText] = useState<string | null>(null);
  const [fdaSmsSent, setFdaSmsSent] = useState<boolean | null>(null);
  const [fdaSmsError, setFdaSmsError] = useState<string | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  async function startCollection() {
    setStatus("running");
    setLogs([]);
    setProgress(null);
    setStats(null);

    const body: Record<string, unknown> = { mode };
    if (mode === "stock") {
      body.keywords = keywordList;
    } else {
      body.channels = channels.split("\n").map(s => s.trim()).filter(Boolean).map(line => {
        const [handle, ...nameParts] = line.split(" ");
        return { handle, name: nameParts.join(" ") || handle };
      });
    }

    try {
      const res = await fetch("/api/admin/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        setLogs([`❌ 오류: ${err.error}`]);
        setStatus("error");
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "log") setLogs(p => [...p, event.message]);
            if (event.type === "progress") setProgress({ done: event.done, total: event.total });
            if (event.type === "error") { setLogs(p => [...p, `❌ ${event.message}`]); setStatus("error"); }
            if (event.type === "done") {
              setLogs(p => [...p, event.message]);
              setStats(event.stats);
              setStatus("done");
            }
          } catch { /* ignore parse error */ }
        }
      }
    } catch (e) {
      setLogs(p => [...p, `❌ 연결 오류: ${e instanceof Error ? e.message : ""}`]);
      setStatus("error");
    }
  }

  async function checkFda() {
    setFdaLoading(true);
    setFdaResults(null);
    setFdaSmsText(null);
    setFdaSmsSent(null);
    setFdaSmsError(null);
    try {
      const res = await fetch("/api/admin/fda-check", { method: "POST" });
      const data = await res.json();
      setFdaResults(data.results ?? []);
      setFdaSmsText(data.smsText ?? null);
      setFdaSmsSent(data.smsSent ?? null);
      setFdaSmsError(data.smsError ?? null);
    } catch (e) {
      setFdaResults([]);
    } finally {
      setFdaLoading(false);
    }
  }

  const progressPct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">정보 수집</h1>
            <p className="text-sm text-gray-500 mt-1">YouTube 영상 자막을 수집하여 RAG 지식베이스를 업데이트합니다</p>
          </div>
          <a href="/" className="text-sm text-blue-600 hover:underline">← 대시보드로</a>
        </div>

        {/* 수집 모드 선택 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
          <h2 className="text-base font-semibold text-gray-900 mb-4">수집 방식 선택</h2>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: "channel", label: "채널 수집", desc: "지정된 YouTube 채널의 최신 영상을 수집합니다", icon: "📡" },
              { id: "stock", label: "종목 키워드 수집", desc: "키워드로 최근 1주일 내 YouTube 영상을 검색·수집합니다", icon: "🔍" },
            ] as const).map(opt => (
              <button
                key={opt.id}
                onClick={() => setMode(opt.id)}
                disabled={status === "running"}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  mode === opt.id ? "border-blue-500 bg-blue-50" : "border-gray-100 hover:border-gray-200 bg-white"
                }`}
              >
                <div className="text-2xl mb-2">{opt.icon}</div>
                <div className="font-medium text-sm text-gray-900">{opt.label}</div>
                <div className="text-xs text-gray-500 mt-1">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 수집 대상 설정 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            {mode === "stock" ? "🔍 검색 키워드 목록" : "📡 채널 목록"}
          </h2>

          {mode === "stock" ? (
            <div>
              <p className="text-xs text-gray-500 mb-3">최근 1주일 내 YouTube 영상을 검색합니다. 키워드를 추가하거나 삭제하세요.</p>

              {/* 키워드 태그 목록 */}
              <div className="flex flex-wrap gap-2 mb-3 min-h-[40px] p-3 border border-gray-200 rounded-xl bg-gray-50">
                {keywordList.map((kw, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
                      i < DEFAULT_KEYWORDS.length
                        ? "bg-blue-100 text-blue-800"
                        : "bg-green-100 text-green-800"
                    }`}
                  >
                    {kw}
                    <button
                      onClick={() => setKeywordList(p => p.filter((_, j) => j !== i))}
                      disabled={status === "running"}
                      className="hover:opacity-60 transition-opacity disabled:opacity-30 ml-0.5"
                      title="삭제"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                {keywordList.length === 0 && (
                  <span className="text-xs text-gray-400 self-center">키워드가 없습니다. 아래에서 추가하세요.</span>
                )}
              </div>

              {/* 키워드 추가 입력 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={e => setNewKeyword(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newKeyword.trim()) {
                      e.preventDefault();
                      const kw = newKeyword.trim();
                      if (!keywordList.includes(kw)) setKeywordList(p => [...p, kw]);
                      setNewKeyword("");
                    }
                  }}
                  disabled={status === "running"}
                  placeholder="종목명 입력 후 Enter (예: 카카오 주식)"
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <button
                  onClick={() => {
                    const kw = newKeyword.trim();
                    if (kw && !keywordList.includes(kw)) setKeywordList(p => [...p, kw]);
                    setNewKeyword("");
                  }}
                  disabled={status === "running" || !newKeyword.trim()}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  추가
                </button>
                <button
                  onClick={() => setKeywordList(DEFAULT_KEYWORDS)}
                  disabled={status === "running"}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm transition-colors disabled:opacity-50"
                  title="기본값으로 초기화"
                >
                  초기화
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                총 <span className="font-medium text-gray-600">{keywordList.length}개</span> 키워드 ·
                <span className="text-blue-600"> 기본 {Math.min(keywordList.length, DEFAULT_KEYWORDS.length)}개</span>
                {keywordList.length > DEFAULT_KEYWORDS.length && (
                  <span className="text-green-600"> + 추가 {keywordList.length - DEFAULT_KEYWORDS.length}개</span>
                )}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-gray-500 mb-2">형식: @핸들 채널명 (한 줄에 하나씩)</p>
              <textarea
                value={channels}
                onChange={e => setChannels(e.target.value)}
                disabled={status === "running"}
                rows={5}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-400 mt-1">
                {channels.split("\n").filter(Boolean).length}개 채널 입력됨
              </p>
            </div>
          )}
        </div>

        {/* 실행 버튼 */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={startCollection}
            disabled={status === "running"}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            {status === "running" ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                수집 중...
              </>
            ) : "▶ 수집 시작"}
          </button>
          {(status === "done" || status === "error") && (
            <button
              onClick={() => { setStatus("idle"); setLogs([]); setProgress(null); setStats(null); }}
              className="px-6 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 rounded-xl text-sm transition-colors"
            >
              초기화
            </button>
          )}
        </div>

        {/* 진행 상황 */}
        {(status !== "idle") && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">실행 로그</h2>
              {progress && (
                <span className="text-sm text-gray-500">{progress.done} / {progress.total}</span>
              )}
            </div>

            {/* 프로그레스 바 */}
            {progress && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>진행률</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* 로그 출력 */}
            <div
              ref={logRef}
              className="bg-gray-950 rounded-xl p-4 h-72 overflow-y-auto font-mono text-xs leading-relaxed"
            >
              {logs.map((line, i) => (
                <div key={i} className={`${
                  line.includes("✅") ? "text-green-400" :
                  line.includes("❌") ? "text-red-400" :
                  line.includes("⚠️") ? "text-yellow-400" :
                  line.includes("📋") || line.includes("📊") ? "text-blue-300" :
                  "text-gray-300"
                }`}>
                  {line}
                </div>
              ))}
              {status === "running" && (
                <div className="text-gray-500 animate-pulse">▋</div>
              )}
            </div>

            {/* 완료 통계 */}
            {stats && (
              <div className="mt-4 grid grid-cols-4 gap-3">
                {[
                  { label: "처리 완료", value: stats.done, color: "text-green-600 bg-green-50" },
                  { label: "자막 없음", value: stats.noTranscript, color: "text-yellow-600 bg-yellow-50" },
                  { label: "오류", value: stats.failed, color: "text-red-600 bg-red-50" },
                  { label: "총 청크", value: stats.totalChunks ?? "-", color: "text-blue-600 bg-blue-50" },
                ].map(s => (
                  <div key={s.label} className={`rounded-xl p-3 text-center ${s.color}`}>
                    <div className="text-xl font-bold">{s.value}</div>
                    <div className="text-xs mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* HLB FDA 승인 모니터링 */}
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-6 mt-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                🏥 HLB FDA 승인 모니터링
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                간암신약 PDUFA <span className="font-medium text-amber-700">2026-07-23</span> &nbsp;·&nbsp;
                담관암신약 PDUFA <span className="font-medium text-amber-700">2026-09-23</span>
              </p>
            </div>
            <button
              onClick={checkFda}
              disabled={fdaLoading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
            >
              {fdaLoading ? (
                <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>확인 중...</>
              ) : "🔍 지금 확인"}
            </button>
          </div>

          {fdaSmsText && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-xs font-semibold text-red-700 mb-1">
                🚨 관련 소식 감지 —{" "}
                {fdaSmsSent === true
                  ? "✅ SMS 전송됨"
                  : fdaSmsSent === false
                  ? "❌ SMS 전송 실패"
                  : "SMS 미전송 (소식 없음)"}
              </p>
              {fdaSmsError && (
                <p className="text-xs text-red-500 mb-1">오류: {fdaSmsError}</p>
              )}
              <pre className="text-xs text-red-800 whitespace-pre-wrap">{fdaSmsText}</pre>
            </div>
          )}

          {fdaResults && (
            <div className="space-y-2">
              {fdaResults.map((r, i) => (
                <div key={i} className={`p-3 rounded-xl border text-xs ${r.found ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-100"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${r.found ? "text-red-700" : "text-gray-600"}`}>{r.source}</span>
                      {r.error && <span className="text-red-400">(오류)</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.found && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${r.approved === true ? "bg-green-100 text-green-700" : r.approved === false ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                          {r.approved === true ? "✅ 승인" : r.approved === false ? "❌ 거절/CRL" : "📋 관련소식"}
                        </span>
                      )}
                      {!r.found && !r.error && <span className="text-gray-400">관련 없음</span>}
                    </div>
                  </div>
                  {r.found && r.matchedKeywords.length > 0 && (
                    <p className="mt-1 text-gray-500">키워드: {r.matchedKeywords.join(", ")}</p>
                  )}
                  {r.snippet && (
                    <p className="mt-1 text-gray-600 line-clamp-2">{r.snippet}</p>
                  )}
                  {r.error && <p className="mt-1 text-red-400">{r.error}</p>}
                </div>
              ))}
              {fdaResults.every(r => !r.found) && (
                <p className="text-center text-sm text-gray-400 py-2">현재 FDA 승인 관련 소식 없음</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
