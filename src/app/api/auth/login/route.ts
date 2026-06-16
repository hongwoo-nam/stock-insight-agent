import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findMemberById } from "@/lib/db/members";
import { signSession, COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { user_id, password } = await req.json();

  if (!user_id || !password)
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });

  const member = await findMemberById(user_id);
  if (!member)
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });

  if (member.del_yn === "Y")
    return NextResponse.json({ error: "탈퇴된 계정입니다." }, { status: 403 });

  if (member.use_yn === "N")
    return NextResponse.json({ error: "관리자 승인 대기 중인 계정입니다. 승인 후 로그인이 가능합니다." }, { status: 403 });

  const valid = await bcrypt.compare(password, member.password_hash);
  if (!valid)
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });

  const token = await signSession({ userId: member.user_id, email: member.email, role: member.role });

  const res = NextResponse.json({
    user: { userId: member.user_id, email: member.email, role: member.role },
  });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7일
    path: "/",
  });
  return res;
}
