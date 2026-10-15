import { ArrowDown, ArrowUp, ArrowUpRight, Minus } from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number;
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string;
  };
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string;
  href: string;
  tone?: 'sage' | 'sky' | 'sand' | 'rose';
  comparison?: {
    current: number;
    previous: number;
    currentLabel: string;
    previousLabel: string;
  };
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
  href,
  tone = 'sage',
  comparison,
}: MetricCardProps) {
  const maximum = comparison
    ? Math.max(comparison.current, comparison.previous, 1)
    : 1;
  return (
    <Link
      href={href}
      data-tone={tone}
      className="crm-metric border-border bg-card rounded-xl border p-5"
    >
      <div className="flex items-start justify-between">
        <p className="text-muted-foreground text-sm font-medium">{title}</p>
        <div className="crm-metric-icon text-primary flex h-9 w-9 items-center justify-center">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <Icon className="crm-metric-watermark" aria-hidden="true" />
      <p className="text-foreground mt-3 text-[28px] leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {delta ? (
        <DeltaRow sign={delta.sign} label={delta.label} />
      ) : subtitle ? (
        <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>
      ) : null}
      {comparison && (
        <div className="crm-metric-comparison">
          {[
            { value: comparison.current, label: comparison.currentLabel },
            { value: comparison.previous, label: comparison.previousLabel },
          ].map((item, index) => (
            <div key={index}>
              <span>{item.label}</span>
              <span className="crm-metric-track" aria-hidden="true">
                <span
                  style={{ transform: `scaleX(${item.value / maximum})` }}
                />
              </span>
              <span>{item.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      <ArrowUpRight
        className="crm-metric-link rtl:-scale-x-100"
        aria-hidden="true"
      />
    </Link>
  );
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
        ? 'text-destructive'
        : 'text-muted-foreground';
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus;
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}
