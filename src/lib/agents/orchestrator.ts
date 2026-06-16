import OpenAI from "openai";
import { createEmbedding } from "@/lib/rag/embeddings";
import { searchSimilarChunks } from "@/lib/rag/vectorStore";
import { AgentResponse, Source } from "@/types";
import { formatTime } from "@/lib/utils";

const SYSTEM_PROMPT = `당신은 슈카월드 YouTube 채널 영상 기반의 주식·경제 정보 참고 서비스입니다.

규칙:
1. 반드시 "이 정보는 투자 참고용이며 투자 판단은 본인이 하셔야 합니다."를 포함하세요.
2. 매수/매도 확정 지시는 절대 하지 마세요.
3. 슈카월드 영상 근거가 없으면 "슈카월드 영상에서 관련 내용을 찾을 수 없습니다."라고 답하세요.
4. 종목 질문 시 다음 구조로 답변하세요:
   1) 현재 질문 요약
   2) 관련 영상 근거
   3) 핵심 논점
   4) 긍정 시나리오
   5) 부정 시나리오
   6) 체크해야 할 지표
   7) 결론 (투자 판단 참고용)
5. 한국어로 답변하세요.
6. 출처 영상은 별도로 제공됩니다.`;

export async function runOrchestrator(
  userMessage: string,
  apiKey: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<AgentResponse> {
  const openai = new OpenAI({ apiKey });

  // RAG search
  const queryEmbedding = await createEmbedding(userMessage, apiKey);
  const chunks = await searchSimilarChunks(queryEmbedding, 5);

  // Filter relevant chunks
  const relevantChunks = chunks.filter((c) => c.similarity > 0.3);

  // Build context
  const context = relevantChunks
    .map(
      (c, i) =>
        `[출처 ${i + 1}] ${c.title} (${c.url}&t=${Math.floor(c.start_time)}s)\n${c.chunk_text}`
    )
    .join("\n\n---\n\n");

  const contextMessage =
    relevantChunks.length > 0
      ? `\n\n[슈카월드 영상 관련 내용]\n${context}`
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
