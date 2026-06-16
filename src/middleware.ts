import { NextRequest, NextResponse } from "next/server";
import { verifySession, COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/signup", "/api/auth/login", "/api/auth/signup"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 공개 경로 허용
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  // 미로그인 → 로그인 페이지
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // 관리자 전용 경로
  if (pathname.startsWith("/admin") && session.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
