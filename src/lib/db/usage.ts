import { getSupabase } from "@/lib/db/client";

// Pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o":                  { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":             { input: 0.15,  output: 0.60  },
  "text-embedding-3-small":  { input: 0.02,  output: 0     },
  "text-embedding-3-large":  { input: 0.13,  output: 0     },
};

export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export async function logUsage(
  type: "chat" | "embedding",
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  try {
    const cost_usd = calcCost(model, inputTokens, outputTokens);
    await getSupabase().from("api_usage").insert({
      type, model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd,
    });
  } catch {
    // 로깅 실패는 메인 흐름에 영향 없음
  }
}
