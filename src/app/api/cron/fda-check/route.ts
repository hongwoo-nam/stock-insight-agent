import { NextRequest, NextResponse } from "next/server";
import { checkFdaApproval, buildSmsMessage } from "@/lib/fda/hlb-monitor";
import { sendSMS } from "@/lib/sms";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 14:30 KST = 05:30 UTC 실행 여부 판단 (뉴스 없어도 문자 전송)
  const nowUtcHour = new Date().getUTCHours();
  const isFinal = nowUtcHour === 5;
  const checkedAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  try {
    const results = await checkFdaApproval();
    const smsText = buildSmsMessage(results);

    const to = process.env.COOLSMS_TO;
    if (!to) {
      return NextResponse.json({ error: "COOLSMS_TO 환경변수 누락" }, { status: 500 });
    }

    // 매 실행마다 결과 문자 전송
    let sentText: string;
    if (smsText) {
      sentText = smsText;
    } else {
      const runLabel = isFinal ? "14:30(최종)" : nowUtcHour === 15 ? "00:30" : "07:30";
      const sourcesSummary = results
        .map(r => `${r.source}: ${r.error ? "오류" : r.found ? "관련소식감지" : "이상없음"}`)
        .join("\n");
      sentText = `[HLB FDA 모니터링 ${runLabel}]\n승인 소식 없음.\n\n${sourcesSummary}\n확인: ${checkedAt}`;
    }

    const smsResult = await sendSMS(to, sentText);

    return NextResponse.json({
      checkedAt,
      isFinal,
      approvalFound: !!smsText,
      smsSent: !!smsResult?.ok,
      smsError: smsResult?.ok === false ? smsResult.error : undefined,
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
