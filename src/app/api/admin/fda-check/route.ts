import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isNextResponse } from "@/lib/auth/guard";
import { checkFdaApproval, buildSmsMessage } from "@/lib/fda/hlb-monitor";
import { sendSMS } from "@/lib/sms";
import { getSupabase } from "@/lib/db/client";

async function getAdminPhones(): Promise<string[]> {
  const { data } = await getSupabase()
    .from("members")
    .select("phone")
    .eq("role", "ADMIN")
    .eq("use_yn", "Y")
    .eq("del_yn", "N");
  return (data ?? []).map(m => m.phone).filter(Boolean);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isNextResponse(auth)) return auth;

  try {
    const results = await checkFdaApproval();
    const smsText  = buildSmsMessage(results);

    let smsSent = false;
    let smsError: string | undefined;

    if (smsText) {
      const phones = await getAdminPhones();
      if (phones.length > 0) {
        for (const phone of phones) {
          const r = await sendSMS(phone, smsText);
          if (!r.ok) smsError = r.error;
          else smsSent = true;
        }
      } else {
        smsError = "등록된 관리자 번호 없음";
      }
    }

    return NextResponse.json({ results, smsText, smsSent, smsError });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
