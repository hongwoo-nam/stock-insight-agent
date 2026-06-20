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

const APPROVAL_KEYWORDS = [
  "approved", "approval", "FDA approves", "grants approval",
  "승인", "FDA 승인", "허가", "신약 승인",
  "Complete Response Letter", "CRL",  // 거절 신호도 중요
  "PDUFA", "action date",
];

const REJECTION_KEYWORDS = [
  "Complete Response Letter", "CRL", "not approved", "refuse to file",
  "거절", "반려", "승인 거부",
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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  // HTML 태그 제거, 공백 정리
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 50000); // 최대 50KB
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

    // 관련 키워드 탐지 (약품명 + 승인 키워드 동시)
    const drugHit = DRUG_TARGETS.some(d =>
      d.keywords.some(kw => textLower.includes(kw.toLowerCase()))
    );
    const approvalHit = APPROVAL_KEYWORDS.some(kw => textLower.includes(kw.toLowerCase()));
    const rejectionHit = REJECTION_KEYWORDS.some(kw => textLower.includes(kw.toLowerCase()));

    const found = drugHit && approvalHit;
    const matchedKeywords: string[] = [];

    if (found) {
      DRUG_TARGETS.forEach(d =>
        d.keywords.forEach(kw => { if (textLower.includes(kw.toLowerCase())) matchedKeywords.push(kw); })
      );
      APPROVAL_KEYWORDS.forEach(kw => { if (textLower.includes(kw.toLowerCase())) matchedKeywords.push(kw); });
    }

    // 첫 번째 매칭 키워드 스니펫
    const snippet = found
      ? extractSnippet(text, matchedKeywords[0] ?? "approved")
      : "";

    const approved = found
      ? (rejectionHit ? false : true)
      : null;

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
