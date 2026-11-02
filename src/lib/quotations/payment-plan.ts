export const PAYMENT_EVENTS = [
  'acceptance',
  'before_installation',
  'delivery',
  'completion',
  'custom',
  'unspecified',
] as const;
export type PaymentEvent = (typeof PAYMENT_EVENTS)[number];
export interface PaymentStage {
  percent: number;
  event: PaymentEvent;
  label?: string;
}
export interface PaymentPlan {
  stages: PaymentStage[];
  notes?: string;
}
export interface PaymentOption {
  key: string;
  shares?: number[];
  events?: PaymentEvent[];
  advanceRange?: [number, number];
  guidance?: string;
}
const clean = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[\u200e\u200f]/g, '')
    .trim();
/** Normalize recorded percentages without inventing the event behind an unnamed instalment. */
export function paymentOptions(raw: string): PaymentOption[] {
  const s = clean(raw),
    options: PaymentOption[] = [];
  if (!s) return options;
  const range = s.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*%/);
  if (range)
    options.push({
      key: `advance-range-${range[1]}-${range[2]}`,
      advanceRange: [+range[1], +range[2]],
      guidance: s,
    });
  if (
    /100\s*%\s*(?:advance|upfront)|(?:advance|upfront)\s*(?:payment\s*)?100\s*%/i.test(
      s
    )
  )
    options.push({
      key: '100-acceptance',
      shares: [100],
      events: ['acceptance'],
    });
  for (const match of s.matchAll(
    /\b(\d{1,3})\s*\/\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/g
  )) {
    const shares = match.slice(1).filter(Boolean).map(Number);
    if (shares.reduce((a, b) => a + b, 0) !== 100) continue;
    options.push({
      key: shares.join('-'),
      shares,
      events: shares.map((_, i) => {
        const before =
          s
            .slice(0, match.index)
            .split(/\bor\b|[();]/i)
            .at(-1) ?? '';
        const after = s
          .slice((match.index ?? 0) + match[0].length)
          .split(/\bor\b|[();]/i)[0];
        return i === 0 && /advance|upfront/i.test(before + after)
          ? 'acceptance'
          : 'unspecified';
      }),
    });
  }
  // Written schedules with explicit events, such as “60% advance, 30% on delivery, 10% on completion”.
  if (!options.length) {
    const parts = [...s.matchAll(/(\d{1,3})\s*%\s*([^,;]+)(?:[,;]|$)/g)];
    if (parts.length && parts.reduce((n, m) => n + Number(m[1]), 0) === 100) {
      const shares = parts.map((m) => +m[1]),
        events = parts.map((m) => eventFromText(m[2]));
      options.push({
        key: shares.join('-') + '-' + events.join('-'),
        shares,
        events,
      });
    }
  }
  if (!options.length)
    options.push({
      key: 'guidance-' + s.toLowerCase().replace(/\W/g, ''),
      guidance: s,
    });
  return options.filter(
    (o, i) => options.findIndex((x) => x.key === o.key) === i
  );
}
export function eventFromText(text: string): PaymentEvent {
  if (/either|or after|to be|specif/i.test(text)) return 'unspecified';
  if (/before.*install/i.test(text)) return 'before_installation';
  if (/advance|upfront|acceptance|مقدم|اعتماد/i.test(text)) return 'acceptance';
  if (/deliver|supply|توريد/i.test(text)) return 'delivery';
  if (/complet|handover|تسليم|انجاز|إنجاز/i.test(text)) return 'completion';
  return 'unspecified';
}
export function optionPlan(option: PaymentOption): PaymentPlan | undefined {
  return option.shares
    ? {
        stages: option.shares.map((percent, i) => ({
          percent,
          event: option.events?.[i] ?? 'unspecified',
        })),
      }
    : undefined;
}
export function eventLabel(event: PaymentEvent, ar = false): string {
  const labels: Record<PaymentEvent, [string, string]> = {
    acceptance: ['On quotation acceptance', 'عند اعتماد عرض السعر'],
    before_installation: ['Before installation', 'قبل التركيب'],
    delivery: ['On delivery to site', 'عند التوريد للموقع'],
    completion: ['On completion and handover', 'عند الإنجاز والتسليم'],
    custom: ['Other payment event', 'موعد دفع آخر'],
    unspecified: ['Choose payment event', 'حدد موعد الدفع'],
  };
  return labels[event][ar ? 1 : 0];
}
export function paymentOptionLabel(option: PaymentOption, ar = false): string {
  if (option.advanceRange)
    return `${option.advanceRange[0]}–${option.advanceRange[1]}% ${ar ? 'دفعة مقدمة — حدد النسبة' : 'advance — choose exact percentage'}`;
  if (
    option.shares?.length === 1 &&
    option.shares[0] === 100 &&
    option.events?.[0] === 'acceptance'
  )
    return ar ? '100% عند اعتماد العرض' : '100% on acceptance';
  if (option.shares) {
    const milestone = option.events?.slice(1).find((e) => e !== 'unspecified');
    return (
      option.shares.map((p) => p + '%').join(' / ') +
      (milestone ? ' · ' + eventLabel(milestone, ar) : '')
    );
  }
  return ar ? 'شروط دفع تحتاج إلى استكمال' : 'Payment terms to complete';
}
export function validPaymentPlan(
  value: unknown,
  forIssue = false
): value is PaymentPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as PaymentPlan;
  if (
    Object.keys(p).some((k) => !['stages', 'notes'].includes(k)) ||
    !Array.isArray(p.stages) ||
    p.stages.length < 1 ||
    p.stages.length > 12 ||
    (p.notes !== undefined &&
      (typeof p.notes !== 'string' || p.notes.length > 10000))
  )
    return false;
  if (
    p.stages.some(
      (s) =>
        !s ||
        Object.keys(s).some(
          (k) => !['percent', 'event', 'label'].includes(k)
        ) ||
        !Number.isFinite(s.percent) ||
        s.percent < 0 ||
        s.percent > 100 ||
        !PAYMENT_EVENTS.includes(s.event) ||
        (s.label !== undefined &&
          (typeof s.label !== 'string' || s.label.length > 1000))
    )
  )
    return false;
  return (
    !forIssue ||
    (Math.abs(p.stages.reduce((n, s) => n + s.percent, 0) - 100) < 0.00000001 &&
      p.stages.every(
        (s) =>
          s.percent > 0 &&
          s.event !== 'unspecified' &&
          (s.event !== 'custom' || !!s.label?.trim())
      ))
  );
}
export function paymentPlanText(plan: PaymentPlan, ar = false): string {
  return plan.stages
    .map(
      (s) =>
        `${s.percent}% — ${s.event === 'custom' ? (s.label ?? '') : eventLabel(s.event, ar)}`
    )
    .join('\n');
}
export function legacyPaymentPlan(schedule: {
  advance: number;
  delivery: number;
  completion: number;
  deliveryTrigger?: string;
}): PaymentPlan {
  return {
    stages: [
      { percent: schedule.advance, event: 'acceptance' },
      {
        percent: schedule.delivery,
        event:
          schedule.deliveryTrigger === 'before_installation'
            ? 'before_installation'
            : 'delivery',
      },
      { percent: schedule.completion, event: 'completion' },
    ].filter((s) => s.percent > 0) as PaymentStage[],
  };
}

export function mergePaymentOptions(options: PaymentOption[]): PaymentOption[] {
  const result: PaymentOption[] = [];
  for (const option of options) {
    const same = result.findIndex(
      (x) =>
        option.shares &&
        x.shares?.join('/') === option.shares.join('/') &&
        !option.events?.some(
          (e, i) =>
            e !== 'unspecified' &&
            x.events?.[i] &&
            x.events[i] !== 'unspecified' &&
            x.events[i] !== e
        )
    );
    if (same >= 0) {
      const current = result[same];
      const events = option.shares!.map((_, i) =>
        current.events?.[i] && current.events[i] !== 'unspecified'
          ? current.events[i]
          : (option.events?.[i] ?? 'unspecified')
      );
      result[same] = {
        ...current,
        events,
        key: current.shares!.join('-') + '-' + events.join('-'),
      };
    } else if (!result.some((x) => x.key === option.key)) result.push(option);
  }
  return result;
}

/** Allocate whole currency cents; avoid rounding each instalment into an extra cent. */
export function paymentAmounts(plan: PaymentPlan, total: number): number[] {
  const cents = Math.round(total * 100),
    complete = validPaymentPlan(plan, true),
    divisor = complete ? plan.stages.reduce((n, s) => n + s.percent, 0) : 100,
    exact = plan.stages.map((s) => (cents * s.percent) / divisor),
    allocated = exact.map(Math.floor),
    target = complete ? cents : Math.round(exact.reduce((a, b) => a + b, 0));
  const order = exact
    .map((n, i) => ({ i, fraction: n - Math.floor(n) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  let remaining = target - allocated.reduce((a, b) => a + b, 0);
  for (const { i } of order) {
    if (remaining <= 0) break;
    allocated[i]++;
    remaining--;
  }
  return allocated.map((n) => n / 100);
}
