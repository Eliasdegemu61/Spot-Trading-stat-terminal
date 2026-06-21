// Server-side fetch helpers for SoDEX spot API.
// Must run server-side only — the gateway returns 403/1010 for non-browser UAs.

const BASE = "https://mainnet-gw.sodex.dev/api/v1/spot";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
export const ADDRESS = process.env.NEXT_PUBLIC_SODEX_ADDRESS
  || "0x0879A87D6D1Ea21C902946F2dAf80a7FAD77BC84";
export const ACCOUNT_ID = process.env.NEXT_PUBLIC_SODEX_ACCOUNT_ID || "1061";

async function getJson<T = any>(path: string, revalidate = 60): Promise<T> {
  const url = `${BASE}/${path}`;
  let attempt = 0;
  while (true) {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate },
    });
    // Respect Sodex IP weight cap (1200/min). On 429, honor Retry-After (seconds).
    if (r.status === 429 && attempt < 4) {
      const ra = parseInt(r.headers.get("Retry-After") || "5", 10);
      const waitMs = Math.min(Math.max(ra, 2), 30) * 1000;
      console.warn(`[sodex] 429 on ${path} — backing off ${waitMs}ms (attempt ${attempt + 1}/4)`);
      await new Promise((res) => setTimeout(res, waitMs));
      attempt++;
      continue;
    }
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }
}

export type Balance = { i: number; a: string; t: string; l: string };
export type Trade = {
  symbol: string;
  tradeID: number;
  orderID: number;
  clOrdID: string;
  side: "BUY" | "SELL";
  price: string;
  quantity: string;
  fee: string;
  feeCoin: string;
  time: number;
  isMaker: boolean;
};
export type Ticker = {
  symbol: string;
  lastPx: string;
  askPx: string;
  bidPx: string;
};

export async function getState() {
  const r = await getJson<{ data: any }>(`accounts/${ADDRESS}/state?accountID=${ACCOUNT_ID}`, 60);
  return r.data || {};
}

export async function getTickers(): Promise<Map<string, number>> {
  // returns map: assetName (e.g. "vSHIB") -> lastPx in vUSDC
  const r = await getJson<{ data: Ticker[] }>(`markets/tickers`, 60);
  const out = new Map<string, number>();
  out.set("vUSDC", 1);
  for (const t of r.data || []) {
    // symbol format: "vXXX_vUSDC"
    if (!t.symbol.endsWith("_vUSDC")) continue;
    const base = t.symbol.slice(0, -"_vUSDC".length);
    const px = parseFloat(t.lastPx);
    if (px > 0) out.set(base, px);
  }
  return out;
}

// Inner paginator: walks a SINGLE time window page-by-page (newest first), deduping by tradeID.
// Returns when the window is exhausted (empty page, sub-limit page, or oldest <= startMs).
async function getTradesWindow(
  startMs: number,
  endMs: number,
  perPage = 1000,
  maxPages = 12,
  seen = new Set<number>()
): Promise<Trade[]> {
  const out: Trade[] = [];
  let cursor = endMs;
  for (let i = 0; i < maxPages; i++) {
    const path =
      `accounts/${ADDRESS}/trades?accountID=${ACCOUNT_ID}` +
      `&startTime=${startMs}&endTime=${cursor}&limit=${perPage}`;
    const r = await getJson<{ data: Trade[] }>(path, 60);
    const rows = r.data || [];
    if (!rows.length) break;
    let addedThisPage = 0;
    let oldest = Infinity;
    for (const t of rows) {
      if (t.time < oldest) oldest = t.time;
      if (!seen.has(t.tradeID)) {
        seen.add(t.tradeID);
        out.push(t);
        addedThisPage++;
      }
    }
    // Stop conditions:
    if (addedThisPage === 0) break;        // entire page was duplicates → we've looped
    if (rows.length < perPage) break;       // server returned fewer than limit → window done
    if (oldest <= startMs) break;           // walked past the window start
    // Move cursor to oldest time (NOT oldest-1) so we catch same-ms trades; dedup handles duplicates
    cursor = oldest;
    // Politeness delay (also helps avoid bursts that look rate-limit-y)
    await new Promise((res) => setTimeout(res, 80));
  }
  return out;
}

// Outer: split [sinceMs, now] into 7-day chunks, walk each chunk newest-first.
// Sodex's trades endpoint behaves more reliably on tighter time windows, so this avoids
// silent truncation we saw on big single-window paginations.
export async function getTrades(sinceMs: number): Promise<Trade[]> {
  const endMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const chunkMs = 7 * dayMs;

  const ranges: Array<[number, number]> = [];
  let cursorEnd = endMs;
  while (cursorEnd > sinceMs) {
    const cursorStart = Math.max(sinceMs, cursorEnd - chunkMs);
    ranges.push([cursorStart, cursorEnd]);
    cursorEnd = cursorStart - 1;
  }

  const seen = new Set<number>();
  const all: Trade[] = [];
  for (const [ws, we] of ranges) {
    const rows = await getTradesWindow(ws, we, 1000, 12, seen);
    all.push(...rows);
    // small gap between chunks
    await new Promise((res) => setTimeout(res, 100));
  }
  // Always log how much we actually fetched so server-side issues are visible in dev.log
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    console.log(
      `[sodex] getTrades: window=${Math.round(
        (endMs - sinceMs) / dayMs
      )}d  chunks=${ranges.length}  fetched=${all.length}  unique=${seen.size}`
    );
  }
  return all;
}

// ---- formatting -----------------------------------------------------------
export function fmtUsd(n: number, decimals = 2) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtNum(n: number, decimals = 4) {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (abs === 0) return "0";
  return n.toFixed(decimals);
}

export function relTime(ms: number) {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function parseSymbol(s: string) {
  const idx = s.lastIndexOf("_");
  if (idx === -1) return { base: s, quote: "" };
  return { base: s.slice(0, idx), quote: s.slice(idx + 1) };
}
