"use client";

import { useState, useEffect, useRef } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminPage() {
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneResult, setCloneResult] = useState("");
  const audioFileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    openai_api_key: "",
    elevenlabs_api_key: "",
    youtube_api_key: "",
    male_voice_id: "",
    female_voice_id: "",
    default_voice: "male",
    collection_schedule: "0 18 * * *",
  });
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setSavedKeys({
          openai_api_key: d.openai_api_key || "",
          elevenlabs_api_key: d.elevenlabs_api_key || "",
          youtube_api_key: d.youtube_api_key || "",
        });
        setForm((prev) => ({
          ...prev,
          male_voice_id: d.male_voice_id || "",
          female_voice_id: d.female_voice_id || "",
          default_voice: d.default_voice || "male",
          collection_schedule: d.collection_schedule || "0 18 * * *",
        }));
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setSaveError("");
    try {
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value) payload[key] = value;
      }
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "저장 실패");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      setSaveError("네트워크 오류가 발생했습니다.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceClone = async () => {
    if (!cloneConsent || !cloneName || !audioFileRef.current?.files?.[0]) return;
    setCloning(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioFileRef.current.files[0]);
      formData.append("name", cloneName);
      formData.append("consent", "true");

      const res = await fetch("/api/voice-clone", { method: "POST", body: formData });
      const data = await res.json();
      if (data.voice_id) {
        setCloneResult(`클로닝 완료! Voice ID: ${data.voice_id}`);
      } else {
        setCloneResult(`오류: ${data.error}`);
      }
    } catch {
      setCloneResult("클로닝에 실패했습니다.");
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">관리자 설정</h1>
          <p className="text-gray-500 text-sm mt-1">API 키, 음성, 수집 스케줄을 설정합니다</p>
        </div>

        {/* API Keys */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>API 키 설정</CardTitle>
            <CardDescription>서비스 운영에 필요한 API 키를 입력하세요</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: "openai_api_key", label: "OpenAI API Key", placeholder: "sk-..." },
              { key: "elevenlabs_api_key", label: "ElevenLabs API Key", placeholder: "xi-..." },
              { key: "youtube_api_key", label: "YouTube Data API v3 Key", placeholder: "AIza..." },
            ].map((field) => (
              <div key={field.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    {field.label}
                  </label>
                  {savedKeys[field.key] && (
                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                      <span>✓ 저장됨</span>
                      <span className="text-gray-400 font-mono">{savedKeys[field.key]}</span>
                    </span>
                  )}
                </div>
                <Input
                  type="password"
                  placeholder={savedKeys[field.key] ? "변경하려면 새 값을 입력하세요" : field.placeholder}
                  value={form[field.key as keyof typeof form]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Voice Settings */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>음성 설정</CardTitle>
            <CardDescription>ElevenLabs Voice ID를 입력하세요</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: "male_voice_id", label: "남성 기본 Voice ID" },
              { key: "female_voice_id", label: "여성 기본 Voice ID" },
            ].map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {field.label}
                </label>
                <Input
                  placeholder="ElevenLabs Voice ID"
                  value={form[field.key as keyof typeof form]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              </div>
            ))}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">기본 음성</label>
              <div className="flex gap-3">
                {["male", "female"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setForm((prev) => ({ ...prev, default_voice: v }))}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      form.default_voice === v
                        ? "border-black bg-black text-white"
                        : "border-gray-200 text-gray-700 hover:border-gray-400"
                    }`}
                  >
                    {v === "male" ? "남성" : "여성"}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Collection Schedule */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>수집 스케줄</CardTitle>
            <CardDescription>Cron 형식으로 입력 (기본: 매일 03:00 KST = 18:00 UTC)</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              value={form.collection_schedule}
              onChange={(e) => setForm((prev) => ({ ...prev, collection_schedule: e.target.value }))}
              placeholder="0 18 * * *"
            />
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={loading} size="lg" className="w-full mb-3">
          {saved ? "✓ 저장 완료" : loading ? "저장 중..." : "설정 저장"}
        </Button>

        {saveError && (
          <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            ⚠️ {saveError}
          </div>
        )}
        {saved && (
          <div className="mb-5 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
            ✓ 설정이 성공적으로 저장되었습니다.
          </div>
        )}

        {/* Voice Cloning */}
        <Card className="border-orange-100">
          <CardHeader>
            <CardTitle>보이스 클로닝</CardTitle>
            <CardDescription>본인 음성 샘플을 업로드하여 맞춤 음성을 생성합니다 (관리자 전용)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">음성 이름</label>
              <Input
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="예: MyVoice"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                음성 샘플 파일 (MP3, WAV, 최소 1분 권장)
              </label>
              <input
                ref={audioFileRef}
                type="file"
                accept="audio/*"
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 file:cursor-pointer"
              />
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded"
                checked={cloneConsent}
                onChange={(e) => setCloneConsent(e.target.checked)}
              />
              <span className="text-sm text-gray-600">
                본인의 음성만 업로드하며, ElevenLabs 약관에 따른 사용에 동의합니다.
                제3자의 음성을 무단으로 클로닝하지 않겠습니다.
              </span>
            </label>

            <Button
              onClick={handleVoiceClone}
              disabled={cloning || !cloneConsent || !cloneName}
              variant="outline"
              className="w-full"
            >
              {cloning ? "클로닝 중..." : "음성 클로닝 시작"}
            </Button>

            {cloneResult && (
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 border border-gray-100">
                {cloneResult}
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
