import {
  getState,
  getTrades,
  getTickers,
  fmtUsd,
  fmtNum,
  relTime,
  ADDRESS,
  ACCOUNT_ID,
  type Balance,
  type Trade,
} from "@/lib/sodex";
import { enrichTrades, balancesUsd } from "@/lib/compute";
import Charts from "./Charts";
import Link from "next/link";

export const revalidate = 60;

function truncAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const RANGE_OPTIONS = [1, 3, 7, 14, 30] as const;
type RangeDays = typeof RANGE_OPTIONS[number];

function parseDays(v: string | string[] | undefined): RangeDays {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (RANGE_OPTIONS as readonly number[]).includes(n) ? (n as RangeDays) : 1;
}

// Estimated weight per refresh for each range — drives the UI warning so the user
// can see what each fetch costs against Sodex's 1200/min IP cap.
// state=5w + tickers=2w + trades pages × (20w + 50 fillweight per 1000-row page).
// Real numbers measured from this account; adjust if the bot trades much more.
const RANGE_WEIGHT: Record<RangeDays, number> = {
  1: 80,     // ~1 page
  3: 220,    // ~3 pages
  7: 770,    // ~11 pages
  14: 1100,  // ~16 pages — near the cap
  30: 1270,  // ~18 pages — at/over the cap; expect 429 backoffs
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = parseDays(sp?.days);
  const sinceMs = Date.now() - days * 24 * 3600 * 1000;
  let state: any = {};
  let trades: Trade[] = [];
  let prices = new Map<string, number>();
  let err: string | null = null;
  try {
    [state, trades, prices] = await Promise.all([getState(), getTrades(sinceMs), getTickers()]);
  } catch (e: any) {
    err = e?.message || String(e);
  }

  const balances: Balance[] = state.B || [];
  const bals = balancesUsd(balances, prices);
  const enriched = enrichTrades(trades, prices);

  // last 24h slice for top KPIs
  const cutoff24 = Date.now() - 24 * 3600 * 1000;
  const last24 = enriched.filter((t) => t.time >= cutoff24);
  const pnl24 = last24.reduce((s, t) => s + t.realized, 0);
  const vol24 = last24.reduce((s, t) => s + t.usdVolume, 0);
  const fees24 = last24.reduce((s, t) => s + t.usdFee, 0);
  const maker24 = last24.length ? (last24.filter((t) => t.isMaker).length / last24.length) * 100 : 0;

  const recent = enriched.slice(0, 50);

  return (
    <main className="min-h-screen bg-bg text-fg p-3 sm:p-6 lg:p-10">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-8">
        {/* Header */}
        <header className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
              SoDEX <span className="dim">·</span> Spot Tracker
            </h1>
            <p className="text-xs sm:text-sm dim mt-1 num">
              {truncAddr(ADDRESS)} <span className="dim">·</span> #{ACCOUNT_ID}{" "}
              <span className="dim">·</span> {trades.length} fills · {days}d
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto -mx-1 px-1">
            <span className="text-[10px] sm:text-xs dim mr-0.5">fetch</span>
            {RANGE_OPTIONS.map((d) => {
              const w = RANGE_WEIGHT[d];
              const heavy = w >= 1100;
              return (
                <Link
                  key={d}
                  href={d === 1 ? "/" : `/?days=${d}`}
                  prefetch={false}
                  title={`~${w} weight / 1200 per minute IP cap${heavy ? " · may 429" : ""}`}
                  className={`text-[11px] sm:text-xs px-2 sm:px-2.5 py-1 rounded-md border transition num whitespace-nowrap ${
                    days === d
                      ? "border-accent/60 text-accent bg-accent/5"
                      : heavy
                      ? "border-yellow-500/30 text-yellow-200/70"
                      : "border-border text-muted"
                  }`}
                >
                  {d === 1 ? "24h" : `${d}d`}
                  <span className="ml-1 text-[9px] sm:text-[10px] opacity-50">~{w}w</span>
                </Link>
              );
            })}
          </div>
        </header>

        {err && (
          <div className="card p-4 text-sm">
            <span className="neg">Error loading data:</span> {err}
          </div>
        )}

        {/* KPIs */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <Kpi
            label="Portfolio value"
            value={`$${fmtUsd(bals.total)}`}
            sub={`${bals.rows.length} assets`}
          />
          <Kpi
            label="24h net PnL"
            value={`${pnl24 >= 0 ? "+" : "-"}$${fmtUsd(Math.abs(pnl24))}`}
            cls={pnl24 >= 0 ? "pos" : "neg"}
          />
          <Kpi
            label="24h volume"
            value={`$${fmtUsd(vol24)}`}
            sub={`${last24.length} fills`}
          />
          <Kpi
            label="24h maker rate"
            value={`${maker24.toFixed(1)}%`}
            sub={`fees $${fmtUsd(fees24, 4)}`}
          />
        </section>

        {/* Charts (client) */}
        <section>
          <Charts trades={enriched} loadedDays={days} />
        </section>

        {/* Recent fills */}
        <section className="card">
          <div className="px-3 sm:px-4 py-3 border-b border-border text-xs uppercase tracking-wider dim">
            Recent fills · last 50
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="text-[10px] sm:text-xs dim">
                <tr>
                  <th className="text-left px-2 sm:px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-2 sm:px-4 py-2 font-medium">Symbol</th>
                  <th className="text-left px-1 sm:px-4 py-2 font-medium">Side</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2 font-medium">Price</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2 font-medium">Qty</th>
                  <th className="text-right px-2 sm:px-4 py-2 font-medium">USD</th>
                  <th className="hidden md:table-cell text-right px-4 py-2 font-medium">Fee $</th>
                  <th className="text-right px-2 sm:px-4 py-2 font-medium">PnL $</th>
                  <th className="text-left px-1 sm:px-4 py-2 font-medium">M/T</th>
                </tr>
              </thead>
              <tbody className="num">
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center dim">
                      No fills.
                    </td>
                  </tr>
                )}
                {recent.map((t) => (
                  <tr key={t.tradeID} className="border-t border-border">
                    <td className="px-2 sm:px-4 py-2 dim whitespace-nowrap">{relTime(t.time)}</td>
                    <td className="px-2 sm:px-4 py-2 whitespace-nowrap">{t.symbol}</td>
                    <td className={`px-1 sm:px-4 py-2 ${t.side === "BUY" ? "pos" : "neg"}`}>{t.side}</td>
                    <td className="hidden sm:table-cell px-4 py-2 text-right">{t.price}</td>
                    <td className="hidden sm:table-cell px-4 py-2 text-right">{t.quantity}</td>
                    <td className="px-2 sm:px-4 py-2 text-right">{fmtUsd(t.usdVolume)}</td>
                    <td className="hidden md:table-cell px-4 py-2 text-right dim">{fmtUsd(t.usdFee, 4)}</td>
                    <td
                      className={`px-2 sm:px-4 py-2 text-right ${
                        t.realized > 0 ? "pos" : t.realized < 0 ? "neg" : "dim"
                      }`}
                    >
                      {t.realized > 0 ? "+" : ""}
                      {fmtUsd(t.realized, 4)}
                    </td>
                    <td className="px-1 sm:px-4 py-2">
                      {t.isMaker ? (
                        <span className="text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded bg-accent/10 pos border border-accent/30">
                          M
                        </span>
                      ) : (
                        <span className="text-[10px] sm:text-xs dim">T</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Balances */}
        <section className="card">
          <div className="px-3 sm:px-4 py-3 border-b border-border text-xs uppercase tracking-wider dim flex justify-between items-center gap-2">
            <span className="truncate">Balances · USD at mark</span>
            <span className="num pos whitespace-nowrap">total ${fmtUsd(bals.total)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="text-[10px] sm:text-xs dim">
                <tr>
                  <th className="text-left px-2 sm:px-4 py-2 font-medium">Asset</th>
                  <th className="text-right px-2 sm:px-4 py-2 font-medium">Qty</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2 font-medium">Mark</th>
                  <th className="text-right px-2 sm:px-4 py-2 font-medium">USD</th>
                  <th className="hidden md:table-cell text-right px-4 py-2 font-medium">Locked</th>
                  <th className="text-right px-2 sm:px-4 py-2 font-medium">%</th>
                </tr>
              </thead>
              <tbody className="num">
                {bals.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center dim">
                      No balances.
                    </td>
                  </tr>
                )}
                {bals.rows.map((b) => (
                  <tr key={b.asset} className="border-t border-border">
                    <td className="px-2 sm:px-4 py-2">{b.asset}</td>
                    <td className="px-2 sm:px-4 py-2 text-right">{fmtNum(b.qty)}</td>
                    <td className="hidden sm:table-cell px-4 py-2 text-right dim">
                      {b.price > 0 ? fmtNum(b.price, 8) : "—"}
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right">
                      {b.usd > 0 ? `$${fmtUsd(b.usd)}` : <span className="dim">—</span>}
                    </td>
                    <td className="hidden md:table-cell px-4 py-2 text-right dim">
                      {b.locked > 0 ? fmtNum(b.locked) : "—"}
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right dim">
                      {bals.total > 0 && b.usd > 0 ? `${((b.usd / bals.total) * 100).toFixed(1)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="text-xs dim text-center pt-4">
          Read-only · prices from /spot/markets/tickers lastPx · server-rendered, 60s cache · ~4 API calls per refresh
        </footer>
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  cls,
}: {
  label: string;
  value: string;
  sub?: string;
  cls?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs dim uppercase tracking-wider">{label}</div>
      <div className={`mt-2 num text-2xl ${cls || ""}`}>{value}</div>
      {sub && <div className="text-xs dim mt-1">{sub}</div>}
    </div>
  );
}
