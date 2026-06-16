import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPendingMembers, getAllMembers, approveMember, rejectMember } from "@/lib/db/members";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin())
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter"); // "pending" | "all"

  const members = filter === "all" ? await getAllMembers() : await getPendingMembers();
  return NextResponse.json({ members });
}

export async function PATCH(req: NextRequest) {
  if (!await requireAdmin())
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const { user_id, action } = await req.json();
  if (!user_id || !action)
    return NextResponse.json({ error: "user_id, action 필요" }, { status: 400 });

  if (action === "approve") {
    await approveMember(user_id);
    return NextResponse.json({ message: `${user_id} 승인 완료` });
  }
  if (action === "reject") {
    await rejectMember(user_id);
    return NextResponse.json({ message: `${user_id} 거절 완료` });
  }

  return NextResponse.json({ error: "유효하지 않은 action" }, { status: 400 });
}
