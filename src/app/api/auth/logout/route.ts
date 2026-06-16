import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ message: "로그아웃되었습니다." });
  res.cookies.set(COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
