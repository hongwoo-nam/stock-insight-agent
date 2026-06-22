import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";
import { checkFdaApproval, buildSmsMessage } from "@/lib/fda/hlb-monitor";
import { sendSMS } from "@/lib/sms";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  try {
    const results = await checkFdaApproval();
    const smsText = buildSmsMessage(results);

    const smsResults: { phone: string; ok: boolean; body?: unknown; error?: string }[] = [];

    if (smsText) {
      const to = process.env.COOLSMS_TO;
      if (to) {
        const r = await sendSMS(to, smsText);
        smsResults.push({ phone: to.slice(0, -4) + "****", ok: r.ok, body: r.body, error: r.error });
      } else {
        smsResults.push({ phone: "-", ok: false, error: "COOLSMS_TO 환경변수가 설정되지 않았습니다." });
      }
    }

    const smsSent  = smsResults.some(r => r.ok);
    const smsError = smsResults.find(r => !r.ok)?.error;

    return NextResponse.json({ results, smsText, smsSent, smsError, smsResults });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
