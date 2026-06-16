import { getSupabase } from "./client";

export interface Member {
  user_id: string;
  email: string;
  phone: string;
  password_hash: string;
  role: "USER" | "ADMIN";
  del_yn: "Y" | "N";
  use_yn: "Y" | "N";
  created_at: string;
  updated_at: string;
}

export async function findMemberById(userId: string): Promise<Member | null> {
  const { data } = await getSupabase()
    .from("members")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data ?? null;
}

export async function findMemberByEmail(email: string): Promise<Member | null> {
  const { data } = await getSupabase()
    .from("members")
    .select("*")
    .eq("email", email)
    .single();
  return data ?? null;
}

export async function createMember(member: {
  user_id: string;
  email: string;
  phone: string;
  password_hash: string;
}): Promise<{ error?: string }> {
  const { error } = await getSupabase().from("members").insert({
    ...member,
    role: "USER",
    del_yn: "N",
    use_yn: "N",
  });
  if (error) {
    if (error.code === "23505") {
      if (error.message.includes("user_id")) return { error: "이미 사용 중인 아이디입니다." };
      if (error.message.includes("email")) return { error: "이미 사용 중인 이메일입니다." };
    }
    return { error: error.message };
  }
  return {};
}

export async function getPendingMembers(): Promise<Member[]> {
  const { data } = await getSupabase()
    .from("members")
    .select("user_id, email, phone, role, del_yn, use_yn, created_at, updated_at")
    .eq("use_yn", "N")
    .eq("del_yn", "N")
    .order("created_at", { ascending: false });
  return (data as Member[]) ?? [];
}

export async function getAllMembers(): Promise<Member[]> {
  const { data } = await getSupabase()
    .from("members")
    .select("user_id, email, phone, role, del_yn, use_yn, created_at, updated_at")
    .order("created_at", { ascending: false });
  return (data as Member[]) ?? [];
}

export async function approveMember(userId: string): Promise<void> {
  await getSupabase()
    .from("members")
    .update({ use_yn: "Y", updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

export async function rejectMember(userId: string): Promise<void> {
  await getSupabase()
    .from("members")
    .update({ del_yn: "Y", updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}
