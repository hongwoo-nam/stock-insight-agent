import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";
import { sendSMS } from "@/lib/sms";
import { getSupabase } from "@/lib/db/client";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (isNextResponse(auth)) return auth;

  const { to, text } = await req.json().catch(() => ({}));

  // to 미지정 시 ADMIN 전화번호 자동 사용
  let targetPhone = to as string | undefined;
  if (!targetPhone) {
    const { data } = await getSupabase()
      .from("members")
      .select("phone")
      .eq("role", "ADMIN")
      .eq("use_yn", "Y")
      .eq("del_yn", "N")
      .limit(1)
      .single();
    targetPhone = data?.phone;
  }

  if (!targetPhone) {
    return NextResponse.json({ ok: false, error: "수신 번호 없음 (to 파라미터 또는 ADMIN 회원 전화번호 필요)" }, { status: 400 });
  }

  const message = (text as string) || "[Stock Insight] SMS 테스트 메시지입니다.";
  const result  = await sendSMS(targetPhone, message);

  return NextResponse.json({
    to:     targetPhone,
    from:   process.env.COOLSMS_FROM ?? "(미설정)",
    text:   message,
    result,
    envSet: {
      COOLSMS_API_KEY:    !!process.env.COOLSMS_API_KEY,
      COOLSMS_API_SECRET: !!process.env.COOLSMS_API_SECRET,
      COOLSMS_FROM:       !!process.env.COOLSMS_FROM,
    },
  });
}
