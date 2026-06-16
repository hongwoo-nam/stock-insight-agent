"use client";

import { useState, useEffect, useCallback } from "react";

interface Member {
  user_id: string;
  email: string;
  phone: string;
  role: string;
  del_yn: string;
  use_yn: string;
  created_at: string;
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/members?filter=${filter}`);
    const data = await res.json();
    setMembers(data.members ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  async function handleAction(userId: string, action: "approve" | "reject") {
    setActionLoading(userId + action);
    setMessage("");
    const res = await fetch("/api/admin/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, action }),
    });
    const data = await res.json();
    setMessage(data.message || data.error);
    setActionLoading(null);
    fetchMembers();
  }

  const statusBadge = (m: Member) => {
    if (m.del_yn === "Y") return <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">거절됨</span>;
    if (m.use_yn === "Y") return <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">승인됨</span>;
    return <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">승인대기</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">회원 관리</h1>
            <p className="text-sm text-gray-500 mt-1">회원가입 승인 및 회원 목록 관리</p>
          </div>
          <a href="/" className="text-sm text-blue-600 hover:underline">← 대시보드로</a>
        </div>

        {message && (
          <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg px-4 py-3">
            {message}
          </div>
        )}

        {/* 필터 탭 */}
        <div className="flex gap-2 mb-4">
          {(["pending", "all"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                filter === f ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f === "pending" ? "⏳ 승인 대기" : "👥 전체 회원"}
            </button>
          ))}
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : members.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              {filter === "pending" ? "승인 대기 중인 회원이 없습니다." : "회원이 없습니다."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["아이디", "이메일", "전화번호", "등급", "상태", "가입일", "작업"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {members.map(m => (
                  <tr key={m.user_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{m.user_id}</td>
                    <td className="px-4 py-3 text-gray-600">{m.email}</td>
                    <td className="px-4 py-3 text-gray-600">{m.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        m.role === "ADMIN" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"
                      }`}>{m.role}</span>
                    </td>
                    <td className="px-4 py-3">{statusBadge(m)}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(m.created_at).toLocaleDateString("ko-KR")}</td>
                    <td className="px-4 py-3">
                      {m.use_yn === "N" && m.del_yn === "N" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAction(m.user_id, "approve")}
                            disabled={actionLoading === m.user_id + "approve"}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-xs rounded-lg transition-colors"
                          >
                            {actionLoading === m.user_id + "approve" ? "처리중..." : "승인"}
                          </button>
                          <button
                            onClick={() => handleAction(m.user_id, "reject")}
                            disabled={actionLoading === m.user_id + "reject"}
                            className="px-3 py-1 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white text-xs rounded-lg transition-colors"
                          >
                            {actionLoading === m.user_id + "reject" ? "처리중..." : "거절"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
