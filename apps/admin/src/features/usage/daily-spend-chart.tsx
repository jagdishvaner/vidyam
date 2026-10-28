"use client";

import type { UsageReport } from "@vidyam/contracts";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

const TOP_PAD = 8; // room for the top tick label
const PLOT_HEIGHT = 140;
const AXIS_BAND = 22;
const LEFT_AXIS = 44;

function daysIn(month: string): string[] {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** A rounded-up axis maximum with three evenly spaced ticks (0, ½, max). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

/**
 * One series, so no legend: the title names it. Thin bars with rounded tops on a shared baseline, a 2px gap
 * between bars, hairline grid, and a tooltip that only adds to what the table view (and the column) already show.
 */
export function DailySpendChart({ report }: { report: UsageReport }) {
  const t = useTranslations("usage");
  const days = daysIn(report.month);
  const byDate = new Map(report.byDay.map((d) => [d.date, d]));
  const max = niceMax(Math.max(0, ...report.byDay.map((d) => d.costUsd)));
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at its real pixel width (not scaled by a viewBox), so axis text stays readable at any size.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.floor(entry!.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const slot = (width - LEFT_AXIS) / days.length;
  const barWidth = Math.max(2, slot - 2);
  const base = TOP_PAD + PLOT_HEIGHT;
  const y = (cost: number) => base - (cost / max) * PLOT_HEIGHT;
  const money = (v: number) => `$${v > 0 && v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
  const hovered = hover === null ? null : days[hover];
  const hoveredSpend = hovered ? byDate.get(hovered) : undefined;

  return (
    <div ref={box} className="relative">
      <svg
        width={width}
        height={base + AXIS_BAND}
        className="block"
        role="img"
        aria-label={t("daily")}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((share) => (
          <g key={share}>
            <line
              x1={LEFT_AXIS}
              x2={width}
              y1={y(max * share)}
              y2={y(max * share)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={LEFT_AXIS - 6}
              y={y(max * share)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {money(max * share)}
            </text>
          </g>
        ))}
        {days.map((date, i) => {
          const spend = byDate.get(date);
          const cost = spend?.costUsd ?? 0;
          const x = LEFT_AXIS + i * slot + 1;
          const top = y(cost);
          const height = base - top;
          const radius = Math.min(4, barWidth / 2, height);
          return (
            <g key={date} onMouseEnter={() => setHover(i)}>
              {/* The hit area is the whole column, so a tiny bar is still easy to point at. */}
              <rect x={x - 1} y={TOP_PAD} width={slot} height={PLOT_HEIGHT} fill="transparent" />
              {cost > 0 && (
                <path
                  d={`M${x},${base} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + barWidth - radius} Q${x + barWidth},${top} ${x + barWidth},${top + radius} V${base} Z`}
                  className="fill-chart-1"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {(i === 0 || (i + 1) % 5 === 0) && (
                <text
                  x={x + barWidth / 2}
                  y={base + 15}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {i + 1}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm"
          style={{
            left: `${((LEFT_AXIS + (hover! + 0.5) * slot) / width) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          {t("dayTooltip", {
            date: hovered,
            cost: money(hoveredSpend?.costUsd ?? 0),
            calls: hoveredSpend?.calls ?? 0,
          })}
        </div>
      )}
    </div>
  );
}
