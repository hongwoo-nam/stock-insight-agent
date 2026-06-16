import { NextRequest, NextResponse } from "next/server";
import { verifySession, COOKIE, SessionPayload } from "@/lib/auth";

export async function requireAuth(req: NextRequest): Promise<SessionPayload | NextResponse> {
  const token = req.cookies.get(COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return session;
}

export async function requireAdmin(req: NextRequest): Promise<SessionPayload | NextResponse> {
  const result = await requireAuth(req);
  if (result instanceof NextResponse) return result;
  if (result.role !== "ADMIN") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  return result;
}

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}
