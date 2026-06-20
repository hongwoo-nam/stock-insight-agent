import crypto from "crypto";

function getAuth(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export async function sendSMS(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey    = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;
  const from      = process.env.COOLSMS_FROM; // 인증된 발신번호

  if (!apiKey || !apiSecret || !from) {
    return { ok: false, error: "COOLSMS_API_KEY / COOLSMS_API_SECRET / COOLSMS_FROM 환경변수 필요" };
  }

  // 수신번호 정규화 (010-xxxx-xxxx → 01xxxxxxxx)
  const toNum = to.replace(/[^0-9]/g, "");

  try {
    const res = await fetch("https://api.coolsms.co.kr/messages/v4/send", {
      method: "POST",
      headers: {
        "Authorization": getAuth(apiKey, apiSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: { to: toNum, from: from.replace(/[^0-9]/g, ""), text },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
