import OpenAI from "openai";
import { createEmbedding } from "@/lib/rag/embeddings";
import { searchSimilarChunks } from "@/lib/rag/vectorStore";
import { AgentResponse, Source } from "@/types";
import { formatTime } from "@/lib/utils";
import { logUsage } from "@/lib/db/usage";

const SYSTEM_PROMPT = `당신은 YouTube 영상(슈카월드, 한국경제TV 등), 경제 뉴스, 기업 공시(DART)를 종합 분석하여 주식·경제 정보를 제공하는 AI입니다.

[답변 구조 — 반드시 아래 형식으로 작성]

## 📈 호재 (긍정 요인)
- 출처에서 언급된 긍정적 사실, 실적, 수치, 발언을 bullet로 나열
- 없으면 "해당 없음"

## 📉 악재 (부정 요인)
- 출처에서 언급된 리스크, 우려, 부정적 수치, 경고를 bullet로 나열
- 없으면 "해당 없음"

## 📋 핵심 포인트
- 호재·악재와 별개로 반드시 알아야 할 사실 2~4개

## 🔍 출처 요약
- 어떤 영상/뉴스/공시에서 위 내용을 확인했는지 간략히

[답변 원칙]
- 구체적인 수치(PER, 매출, 날짜, 금액 등)와 발언을 그대로 인용하세요.
- 영상·뉴스·공시에 없는 내용은 절대 추측하지 마세요.
- 관련 출처가 전혀 없으면 "수집된 자료에서 관련 내용을 찾을 수 없습니다."라고만 답하세요.
- ※ 이 정보는 투자 참고용이며 투자 판단은 본인이 하셔야 합니다.
- 한국어로 답변하세요.`;

export async function runOrchestrator(
  userMessage: string,
  apiKey: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<AgentResponse> {
  const openai = new OpenAI({ apiKey });

  // RAG search
  const queryEmbedding = await createEmbedding(userMessage, apiKey);
  const chunks = await searchSimilarChunks(queryEmbedding, 8);

  // Filter relevant chunks
  const relevantChunks = chunks.filter((c) => c.similarity > 0.25);

  // Build context
  const context = relevantChunks
    .map(
      (c, i) =>
        `[출처 ${i + 1}: "${c.title}" — ${Math.floor(c.start_time / 60)}분 ${Math.floor(c.start_time % 60)}초]\n${c.chunk_text}`
    )
    .join("\n\n---\n\n");

  const contextMessage =
    relevantChunks.length > 0
      ? `\n\n아래는 슈카월드 영상에서 관련 부분을 발췌한 내용입니다. 이 내용을 바탕으로 답변해 주세요:\n\n${context}`
      : "\n\n[슈카월드 영상에서 관련 내용을 찾을 수 없습니다]";

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.map((h) => ({
      role: h.role,
      content: h.content,
    })),
    {
      role: "user",
      content: userMessage + contextMessage,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0.3,
    max_tokens: 2000,
  });

  const answer = completion.choices[0].message.content || "";

  // 사용량 로깅 (비동기, 실패해도 무시)
  const usage = completion.usage;
  if (usage) {
    void logUsage("chat", "gpt-4o", usage.prompt_tokens, usage.completion_tokens);
  }

  // Extract risk points from answer
  const riskPoints = extractRiskPoints(answer);

  const sources: Source[] = relevantChunks.map((c) => ({
    video_id: c.video_id,
    title: c.title,
    url: `${c.url}&t=${Math.floor(c.start_time)}`,
    start_time: c.start_time,
    chunk_text: c.chunk_text,
    similarity: c.similarity,
  }));

  return { answer, sources, risk_points: riskPoints };
}

function extractRiskPoints(text: string): string[] {
  const patterns = [
    /리스크[:\s]+([^\n]+)/g,
    /위험[:\s]+([^\n]+)/g,
    /주의[:\s]+([^\n]+)/g,
    /체크해야 할 지표[:\s]*\n((?:[-•]\s*.+\n?)+)/g,
  ];

  const points: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const items = match[1]
        .split(/[-•\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 2 && s.length < 50);
      points.push(...items);
    }
  }

  return [...new Set(points)].slice(0, 5);
}
