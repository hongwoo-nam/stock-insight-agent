/**
 * HLB FDA 승인 모니터링
 *
 * 대상 의약품:
 * - 간암신약: rivoceranib + camrelizumab 병용 (PDUFA 2026-07-23)
 * - 담관암신약: rivoceranib (PDUFA 2026-09-23 예정)
 */

const DRUG_TARGETS = [
  {
    name: "간암신약 (rivoceranib + camrelizumab)",
    keywords: ["rivoceranib", "camrelizumab", "HLB", "hepatocellular", "간암"],
    pdufa: "2026-07-23",
  },
  {
    name: "담관암신약 (rivoceranib)",
    keywords: ["rivoceranib", "cholangiocarcinoma", "담관암", "biliary"],
    pdufa: "2026-09-23",
  },
];

// FDA 최종 승인 뉴스에만 나타나는 표현
const APPROVAL_KEYWORDS = [
  "FDA approves", "FDA approved", "grants approval", "approved by the FDA",
  "new drug application approved", "NDA approved", "BLA approved",
  "FDA 승인", "신약 승인", "허가 승인",
];

const REJECTION_KEYWORDS = [
  "Complete Response Letter", "CRL", "not approved", "refuse to file",
  "거절", "반려", "승인 거부",
];

// 이 키워드가 승인 키워드 근처에 있으면 오탐으로 제외
const FALSE_POSITIVE_KEYWORDS = [
  "resubmission", "re-submission", "accepts filing", "accepted the filing",
  "filing acceptance", "accepted for filing", "filing accepted",
  "accepts the resubmission", "accepted the resubmission",
  "under review", "under fda review", "pdufa date", "pdufa goal date",
  "seeking approval", "submitted", "submission accepted",
];

const SOURCES = [
  {
    name: "FDA Press Announcements",
    url: "https://www.fda.gov/news-events/newsroom/press-announcements",
    selector: "text",
  },
  {
    name: "FDA Drugs@FDA",
    url: "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=BasicSearch.process&query=rivoceranib",
    selector: "text",
  },
  {
    name: "HLB IR 공시",
    url: "https://www.hlb.co.kr/irinfo/notice/irnotice.do",
    selector: "text",
  },
  {
    name: "Elevar Therapeutics",
    url: "https://elevartx.com/news/",
    selector: "text",
  },
  {
    name: "항서제약 뉴스",
    url: "https://www.hengrui.com/en/media-center/news/",
    selector: "text",
  },
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml",
};

export interface FdaCheckResult {
  source: string;
  url: string;
  found: boolean;
  approved: boolean | null; // true=승인, false=거절, null=관련없음
  matchedKeywords: string[];
  snippet: string;
  checkedAt: string;
  error?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 50000);
}

// HLB 사이트는 self-signed 인증서 → Node.js https 모듈로 직접 요청
function fetchHlbText(url: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const https = await import("https");
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      rejectUnauthorized: false,
      headers: HEADERS,
      timeout: 15000,
    };
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(stripHtml(Buffer.concat(chunks).toString("utf-8"))));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function fetchText(url: string): Promise<string> {
  if (url.includes("hlb.co.kr")) return fetchHlbText(url);
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  return stripHtml(await res.text());
}

function extractSnippet(text: string, keyword: string, radius = 200): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return "";
  return "..." + text.slice(Math.max(0, idx - radius), idx + radius) + "...";
}

export async function checkFdaApproval(): Promise<FdaCheckResult[]> {
  const results: FdaCheckResult[] = [];
  const checkedAt = new Date().toISOString();

  for (const source of SOURCES) {
    let text = "";
    let error: string | undefined;

    try {
      text = await fetchText(source.url);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (error || !text) {
      results.push({ source: source.name, url: source.url, found: false, approved: null, matchedKeywords: [], snippet: "", checkedAt, error });
      continue;
    }

    const textLower = text.toLowerCase();
    const PROXIMITY = 600; // 약품명과 승인 키워드가 이 글자 수 이내에 있어야 함

    // 약품명 위치 수집
    const drugPositions: { kw: string; idx: number }[] = [];
    for (const d of DRUG_TARGETS) {
      for (const kw of d.keywords) {
        let idx = textLower.indexOf(kw.toLowerCase());
        while (idx !== -1) {
          drugPositions.push({ kw, idx });
          idx = textLower.indexOf(kw.toLowerCase(), idx + 1);
        }
      }
    }

    // 승인/거절 키워드와 약품명이 PROXIMITY 이내에 있는지 확인, 오탐 키워드가 같은 구간에 없는지 검증
    let found = false;
    let rejectionHit = false;
    const matchedKeywords: string[] = [];
    let snippetStart = -1;

    const allSignalKws = [...APPROVAL_KEYWORDS, ...REJECTION_KEYWORDS];
    for (const sigKw of allSignalKws) {
      const sigIdx = textLower.indexOf(sigKw.toLowerCase());
      if (sigIdx === -1) continue;

      for (const { kw: drugKw, idx: drugIdx } of drugPositions) {
        if (Math.abs(sigIdx - drugIdx) > PROXIMITY) continue;

        // 해당 구간에 오탐 키워드가 있으면 건너뜀
        const segStart = Math.min(sigIdx, drugIdx) - 100;
        const segEnd   = Math.max(sigIdx, drugIdx) + sigKw.length + 100;
        const segment  = textLower.slice(Math.max(0, segStart), segEnd);
        const isFalsePositive = FALSE_POSITIVE_KEYWORDS.some(fp => segment.includes(fp.toLowerCase()));
        if (isFalsePositive) continue;

        found = true;
        if (!matchedKeywords.includes(drugKw)) matchedKeywords.push(drugKw);
        if (!matchedKeywords.includes(sigKw)) matchedKeywords.push(sigKw);
        if (snippetStart === -1) snippetStart = Math.min(sigIdx, drugIdx);
        if (REJECTION_KEYWORDS.some(r => r.toLowerCase() === sigKw.toLowerCase())) rejectionHit = true;
      }
    }

    const snippet = found && snippetStart !== -1
      ? "..." + text.slice(Math.max(0, snippetStart - 100), snippetStart + 400) + "..."
      : "";

    const approved = found ? (rejectionHit ? false : true) : null;

    results.push({ source: source.name, url: source.url, found, approved, matchedKeywords: [...new Set(matchedKeywords)], snippet, checkedAt });
  }

  return results;
}

export function buildSmsMessage(results: FdaCheckResult[]): string | null {
  const hits = results.filter(r => r.found);
  if (hits.length === 0) return null;

  const approvals  = hits.filter(r => r.approved === true);
  const rejections = hits.filter(r => r.approved === false);

  let msg = "[HLB FDA 알림]\n";

  if (approvals.length > 0) {
    msg += "🎉 FDA 승인 감지!\n";
    msg += approvals.map(r => `- ${r.source}`).join("\n") + "\n";
    msg += `키워드: ${approvals[0].matchedKeywords.slice(0, 3).join(", ")}\n`;
  } else if (rejections.length > 0) {
    msg += "⚠️ CRL(거절) 또는 관련 소식 감지\n";
    msg += rejections.map(r => `- ${r.source}`).join("\n") + "\n";
  } else {
    msg += "📋 FDA 관련 소식 감지\n";
    msg += hits.map(r => `- ${r.source}`).join("\n") + "\n";
  }

  msg += `확인: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`;
  return msg.slice(0, 2000); // SMS 길이 제한
}
