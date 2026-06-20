import crypto from "crypto";

function getAuth(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export interface SmsResult {
  ok: boolean;
  statusCode?: number;
  body?: unknown;
  error?: string;
}

export async function sendSMS(to: string, text: string): Promise<SmsResult> {
  const apiKey    = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;
  const from      = process.env.COOLSMS_FROM;

  if (!apiKey || !apiSecret || !from) {
    return { ok: false, error: "COOLSMS_API_KEY / COOLSMS_API_SECRET / COOLSMS_FROM 환경변수 누락" };
  }

  const toNum   = to.replace(/[^0-9]/g, "");
  const fromNum = from.replace(/[^0-9]/g, "");

  // SMS는 90바이트(한글 45자) 이하, 초과 시 LMS 자동 전환
  const payload = {
    message: {
      to:   toNum,
      from: fromNum,
      text: text.slice(0, 2000),
    },
  };

  try {
    const res = await fetch("https://api.coolsms.co.kr/messages/v4/send", {
      method:  "POST",
      headers: {
        Authorization:  getAuth(apiKey, apiSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text(); }

    // CoolSMS: HTTP 4xx/5xx = 명시적 실패
    if (!res.ok) {
      return { ok: false, statusCode: res.status, body, error: JSON.stringify(body) };
    }

    // HTTP 200이어도 body 안에 errorCode가 있으면 실패
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (b.errorCode || b.error) {
        return { ok: false, statusCode: res.status, body, error: String(b.errorCode ?? b.error) };
      }
    }

    return { ok: true, statusCode: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
