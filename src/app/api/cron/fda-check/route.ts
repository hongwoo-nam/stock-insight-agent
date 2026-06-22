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

    let sentText: string | null = null;
    let smsResult = null;

    if (smsText) {
      // 승인 뉴스 감지 → 즉시 문자
      sentText = smsText;
    } else if (isFinal) {
      // 14:30 KST 마지막 체크에서 뉴스 없음 → 없음 안내 문자
      sentText = `[HLB FDA 모니터링]\n오늘(${checkedAt.slice(0, 10)}) FDA 승인 관련 소식 없음.\n내일도 계속 모니터링합니다.`;
    }

    if (sentText) {
      smsResult = await sendSMS(to, sentText);
    }

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
