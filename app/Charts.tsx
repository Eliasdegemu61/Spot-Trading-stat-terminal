"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { EnrichedTrade } from "@/lib/compute";
import { bucketize, bucketsFor, type Timeframe } from "@/lib/compute";
import { fmtUsd } from "@/lib/sodex";

const TIMEFRAMES: { id: Timeframe; label: string; needsDays: number }[] = [
  { id: "24h", label: "24h (hourly)", needsDays: 1 },
  { id: "7d-hourly", label: "7d (hourly)", needsDays: 7 },
  { id: "7d-daily", label: "7d (daily)", needsDays: 7 },
  { id: "30d-daily", label: "30d (daily)", needsDays: 30 },
];

const COLORS = {
  pnl: "#bef264",
  pnlNeg: "#f87171",
  volume: "#60a5fa",
  fees: "#fbbf24",
  maker: "#34d399",
  grid: "#1f1f1f",
  axis: "#6b7280",
};

export default function Charts({
  trades,
  loadedDays,
}: {
  trades: EnrichedTrade[];
  loadedDays: number;
}) {
  // Pick the most useful default tf for the loaded window:
  // - 24h if window is ≥1d (always)
  // - bump to 7d-daily if user loaded ≥7d
  const defaultTf: Timeframe = loadedDays >= 7 ? "7d-daily" : "24h";
  const [tf, setTf] = useState<Timeframe>(defaultTf);

  const buckets = useMemo(() => bucketize(trades, tf), [trades, tf]);
  const { label } = bucketsFor(tf);

  const data = useMemo(
    () =>
      buckets.map((b) => ({
        ts: b.tsStart,
        t: label(b.tsStart),
        pnl: +b.pnl.toFixed(4),
        volume: +b.volume.toFixed(2),
        fees: +b.fees.toFixed(4),
        trades: b.trades,
        makerRate: b.trades > 0 ? +((b.makerTrades / b.trades) * 100).toFixed(1) : null,
      })),
    [buckets, label]
  );

  // summary across visible buckets
  const totals = useMemo(() => {
    const t = data.reduce(
      (a, x) => ({
        pnl: a.pnl + x.pnl,
        volume: a.volume + x.volume,
        fees: a.fees + x.fees,
        trades: a.trades + x.trades,
        makerTrades: a.makerTrades + (x.makerRate !== null ? (x.makerRate / 100) * x.trades : 0),
      }),
      { pnl: 0, volume: 0, fees: 0, trades: 0, makerTrades: 0 }
    );
    return {
      ...t,
      makerRate: t.trades > 0 ? (t.makerTrades / t.trades) * 100 : 0,
    };
  }, [data]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* timeframe pills */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {TIMEFRAMES.map((x) => {
          const disabled = x.needsDays > loadedDays;
          return (
            <button
              key={x.id}
              onClick={() => !disabled && setTf(x.id)}
              title={disabled ? `Load ≥${x.needsDays}d via the fetch buttons above` : undefined}
              disabled={disabled}
              className={`text-[11px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 rounded-md border transition whitespace-nowrap ${
                disabled
                  ? "border-border/40 text-muted/40 cursor-not-allowed"
                  : tf === x.id
                  ? "border-accent/60 text-accent bg-accent/5"
                  : "border-border text-muted"
              }`}
            >
              {x.label}
            </button>
          );
        })}
      </div>

      {/* window totals — own line on mobile so pills don't get squeezed */}
      <div className="text-[11px] sm:text-xs dim num flex flex-wrap gap-x-3 gap-y-1">
        <span>
          PnL{" "}
          <span className={totals.pnl >= 0 ? "pos" : "neg"}>${fmtUsd(totals.pnl)}</span>
        </span>
        <span>vol ${fmtUsd(totals.volume)}</span>
        <span>fees ${fmtUsd(totals.fees)}</span>
        <span>{totals.trades} fills</span>
        <span>{totals.makerRate.toFixed(1)}% maker</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <ChartCard title="Net PnL (USD)" subtitle="realized incl. fees · running-avg cost">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="t" stroke={COLORS.axis} fontSize={10} tickMargin={6} />
              <YAxis stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => `$${v}`} />
              <ReferenceLine y={0} stroke="#374151" />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                formatter={(v: any) => [`$${(v as number).toFixed(4)}`, "PnL"]}
              />
              <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                {data.map((d, i) => (
                  <rect
                    key={i}
                    fill={d.pnl >= 0 ? COLORS.pnl : COLORS.pnlNeg}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Volume (USD)" subtitle="vUSDC quote-pair notional">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="t" stroke={COLORS.axis} fontSize={10} tickMargin={6} />
              <YAxis stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                formatter={(v: any) => [`$${fmtUsd(v as number)}`, "Volume"]}
              />
              <Bar dataKey="volume" fill={COLORS.volume} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Fees (USD)" subtitle="per-trade fee × price of feeCoin">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="t" stroke={COLORS.axis} fontSize={10} tickMargin={6} />
              <YAxis stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                formatter={(v: any) => [`$${(v as number).toFixed(4)}`, "Fees"]}
              />
              <Bar dataKey="fees" fill={COLORS.fees} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Maker rate (%)" subtitle="per-bucket maker share">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="t" stroke={COLORS.axis} fontSize={10} tickMargin={6} />
              <YAxis stroke={COLORS.axis} fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                formatter={(v: any) => [v === null ? "—" : `${v}%`, "Maker"]}
              />
              <Line
                type="monotone"
                dataKey="makerRate"
                stroke={COLORS.maker}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "#0f0f0f",
  border: "1px solid #1f1f1f",
  borderRadius: 6,
  fontSize: 12,
  color: "#e5e7eb",
  padding: "6px 10px",
};
const tooltipLabelStyle: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: 11,
  marginBottom: 4,
  fontWeight: 500,
};
const tooltipItemStyle: React.CSSProperties = {
  color: "#e5e7eb",
  fontSize: 12,
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
};

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-baseline justify-between mb-2 sm:mb-3 gap-2">
        <h3 className="text-xs sm:text-sm font-medium">{title}</h3>
        {subtitle && (
          <span className="text-[10px] sm:text-xs dim truncate">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}
