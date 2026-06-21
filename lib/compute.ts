import type { Trade, Balance } from "./sodex";
import { parseSymbol } from "./sodex";

// ---------- Trade with USD ----------
export type EnrichedTrade = Trade & {
  usdVolume: number;   // notional in USD (vUSDC)
  usdFee: number;      // fee converted to USD
  realized: number;    // running-avg-cost realized PnL contribution (USD), only on SELL
};

// Convert each trade to USD using ticker prices (lastPx in vUSDC).
// Then walk per-symbol chronologically to compute realized PnL using weighted-avg cost.
export function enrichTrades(trades: Trade[], prices: Map<string, number>): EnrichedTrade[] {
  // sort chronological (oldest first) for FIFO/avg-cost walk
  const chrono = [...trades].sort((a, b) => a.time - b.time);

  // running avg-cost per base asset (only for _vUSDC pairs)
  const cost = new Map<string, { qty: number; avg: number }>();

  const out: EnrichedTrade[] = chrono.map((t) => {
    const { base, quote } = parseSymbol(t.symbol);
    const px = parseFloat(t.price);
    const qty = parseFloat(t.quantity);
    const fee = parseFloat(t.fee);

    // USD volume: only if quote is vUSDC (otherwise we'd need to chain prices)
    const usdVolume = quote === "vUSDC" ? px * qty : qty * (prices.get(base) ?? 0) * (prices.get(quote) ?? 1);

    // USD fee: convert feeCoin to USD via lastPx
    const feePx = prices.get(t.feeCoin) ?? 0;
    const usdFee = fee * feePx;

    // Avg-cost realized PnL on SELLs (only for vUSDC quote pairs)
    let realized = 0;
    if (quote === "vUSDC") {
      const entry = cost.get(base) ?? { qty: 0, avg: 0 };
      if (t.side === "BUY") {
        const newQty = entry.qty + qty;
        const newAvg = newQty > 0 ? (entry.avg * entry.qty + px * qty) / newQty : 0;
        cost.set(base, { qty: newQty, avg: newAvg });
        // fee on BUY raises effective cost slightly — subtract from realized later via -usdFee
      } else {
        // SELL: realized = (sell_px - avg_cost) * qty
        if (entry.qty > 0) {
          const matched = Math.min(entry.qty, qty);
          realized = (px - entry.avg) * matched;
          entry.qty -= matched;
          if (entry.qty <= 0) entry.qty = 0;
          cost.set(base, entry);
        } else {
          // short sale (no prior inventory) — record cost as negative; we'll treat as 0 realized
        }
      }
    }

    // every trade pays fee → subtract from realized
    realized -= usdFee;

    return { ...t, usdVolume, usdFee, realized };
  });

  // re-sort newest first for display
  return out.sort((a, b) => b.time - a.time);
}

// ---------- Time-bucketed series ----------
export type Bucket = {
  tsStart: number;       // bucket start (ms)
  pnl: number;
  volume: number;
  fees: number;
  trades: number;
  makerTrades: number;
};

export type Timeframe = "24h" | "7d-hourly" | "7d-daily" | "30d-daily";

export function bucketsFor(tf: Timeframe): { sizeMs: number; count: number; label: (t: number) => string } {
  switch (tf) {
    case "24h":
      return { sizeMs: 60 * 60 * 1000, count: 24, label: (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    case "7d-hourly":
      return { sizeMs: 60 * 60 * 1000, count: 24 * 7, label: (t) => new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit" }) };
    case "7d-daily":
      return { sizeMs: 24 * 60 * 60 * 1000, count: 7, label: (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) };
    case "30d-daily":
      return { sizeMs: 24 * 60 * 60 * 1000, count: 30, label: (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) };
  }
}

export function bucketize(trades: EnrichedTrade[], tf: Timeframe): Bucket[] {
  const { sizeMs, count } = bucketsFor(tf);
  const now = Date.now();
  // align to bucket boundary (going backward)
  const endAligned = Math.floor(now / sizeMs) * sizeMs + sizeMs; // next bucket boundary
  const startMs = endAligned - sizeMs * count;
  const buckets: Bucket[] = [];
  for (let i = 0; i < count; i++) {
    buckets.push({
      tsStart: startMs + i * sizeMs,
      pnl: 0,
      volume: 0,
      fees: 0,
      trades: 0,
      makerTrades: 0,
    });
  }
  for (const t of trades) {
    if (t.time < startMs || t.time >= endAligned) continue;
    const idx = Math.floor((t.time - startMs) / sizeMs);
    if (idx < 0 || idx >= count) continue;
    const b = buckets[idx];
    b.pnl += t.realized;
    b.volume += t.usdVolume;
    b.fees += t.usdFee;
    b.trades += 1;
    if (t.isMaker) b.makerTrades += 1;
  }
  return buckets;
}

// ---------- Balance USD ----------
export function balancesUsd(balances: Balance[], prices: Map<string, number>) {
  const rows = balances
    .map((b) => {
      const qty = parseFloat(b.t || "0");
      const px = prices.get(b.a) ?? 0;
      const usd = qty * px;
      return { asset: b.a, qty, locked: parseFloat(b.l || "0"), price: px, usd };
    })
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.usd - a.usd);
  const total = rows.reduce((s, r) => s + r.usd, 0);
  return { rows, total };
}
