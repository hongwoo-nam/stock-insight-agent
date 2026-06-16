import OpenAI from "openai";
import { createEmbedding } from "@/lib/rag/embeddings";
import { searchSimilarChunks } from "@/lib/rag/vectorStore";
import { AgentResponse, Source } from "@/types";
import { formatTime } from "@/lib/utils";
import { logUsage } from "@/lib/db/usage";

const SYSTEM_PROMPT = `당신은 슈카월드 YouTube 채널 영상 내용을 기반으로 주식·경제 정보를 분석해주는 AI입니다.

[답변 원칙]
- 출처 영상의 구체적인 수치, 발언, 논리를 최대한 직접 인용하세요.
- "~했습니다" 식의 막연한 요약 대신, 영상에서 언급된 구체적인 내용(PER, 시총, 매출, 날짜, 인물 발언 등)을 그대로 사용하세요.
- 관련 영상 내용이 충분하면 아래 구조로 답변하세요:

  **슈카월드 영상에서 뭐라고 했나**
  (영상 제목과 함께 핵심 발언/수치를 직접 인용)

  **핵심 포인트**
  (영상에서 강조한 논점 2~4개를 bullet로)

  **긍정 / 부정 시각**
  (영상에서 다룬 상승·하락 근거)

  **투자 참고 시 체크할 것**
  (영상에서 언급한 리스크 지표 또는 모니터링 포인트)

  ※ 이 정보는 투자 참고용이며 투자 판단은 본인이 하셔야 합니다.

- 출처 영상에 관련 내용이 없으면 "슈카월드 영상에서 해당 주제를 다룬 내용이 없습니다."라고 솔직하게 답하세요. 억지로 답변을 만들지 마세요.
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
