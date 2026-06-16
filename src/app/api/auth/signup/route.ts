import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createMember, findMemberById } from "@/lib/db/members";

export async function POST(req: NextRequest) {
  const { user_id, email, phone, password } = await req.json();

  if (!user_id || !email || !phone || !password)
    return NextResponse.json({ error: "모든 항목을 입력해주세요." }, { status: 400 });

  if (!/^[a-zA-Z0-9_]{4,20}$/.test(user_id))
    return NextResponse.json({ error: "아이디는 4~20자 영문·숫자·언더바만 사용 가능합니다." }, { status: 400 });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return NextResponse.json({ error: "올바른 이메일 형식이 아닙니다." }, { status: 400 });

  if (!/^01[0-9]{8,9}$/.test(phone.replace(/-/g, "")))
    return NextResponse.json({ error: "올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)" }, { status: 400 });

  if (password.length < 8)
    return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });

  const existing = await findMemberById(user_id);
  if (existing)
    return NextResponse.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });

  const password_hash = await bcrypt.hash(password, 12);
  const { error } = await createMember({ user_id, email, phone, password_hash });

  if (error) return NextResponse.json({ error }, { status: 409 });

  return NextResponse.json({ message: "회원가입이 완료되었습니다. 관리자 승인 후 로그인이 가능합니다." });
}
