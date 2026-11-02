'use client';
import { TermPresetField } from './term-preset-field';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PAYMENT_EVENTS,
  paymentAmounts,
  eventLabel,
  paymentOptionLabel,
  optionPlan,
  validPaymentPlan,
  type PaymentPlan,
  type PaymentOption,
} from '@/lib/quotations/payment-plan';
export function PaymentPlanEditor({
  plan,
  options,
  total,
  currency,
  disabled,
  onChange,
}: {
  plan?: PaymentPlan;
  options: PaymentOption[];
  total: number;
  currency: string;
  disabled: boolean;
  onChange: (p: PaymentPlan | undefined) => void;
}) {
  const ar = useLocale() === 'ar',
    l = (en: string, a: string) => (ar ? a : en);
  const amounts = plan ? paymentAmounts(plan, total) : [];
  const sum = plan?.stages.reduce((n, s) => n + s.percent, 0) ?? 0;
  const money = (n: number) =>
    new Intl.NumberFormat(ar ? 'ar-QA' : 'en-QA', {
      style: 'currency',
      currency,
    }).format(n);
  function patch(i: number, value: Partial<PaymentPlan['stages'][number]>) {
    if (plan)
      onChange({
        ...plan,
        stages: plan.stages.map((s, j) => (i === j ? { ...s, ...value } : s)),
      });
  }
  return (
    <section
      className="qp-payment"
      aria-label={l('Payment schedule', 'جدول الدفعات')}
    >
      <div className="qp-section-heading">
        <div>
          <h3>{l('Payment schedule', 'جدول الدفعات')}</h3>
          <p>
            {l(
              'Set the percentage and payment event for each instalment.',
              'حدد النسبة وموعد الدفع لكل دفعة.'
            )}
          </p>
        </div>
        <strong className={sum === 100 ? 'qp-good' : 'qp-incomplete'}>
          {sum}% / 100%
        </strong>
      </div>
      <label className="qp-payment-preset">
        {l('Payment arrangement', 'ترتيب الدفع')}
        <select
          aria-label={l('Payment arrangement', 'ترتيب الدفع')}
          disabled={disabled}
          value={String(
            options.findIndex((o) => {
              const candidate = optionPlan(o);
              return (
                candidate &&
                JSON.stringify(candidate.stages) ===
                  JSON.stringify(plan?.stages)
              );
            })
          )}
          onChange={(e) => {
            const index = Number(e.target.value);
            if (index >= 0) onChange(optionPlan(options[index]));
            else if (!plan)
              onChange({ stages: [{ percent: 100, event: 'unspecified' }] });
          }}
        >
          <option value="-1">
            {plan
              ? l('Custom / edited schedule', 'جدول مخصص / معدل')
              : l('Choose a recorded arrangement', 'اختر ترتيب دفع مسجل')}
          </option>
          {options.map((o, i) => (
            <option key={o.key} value={i} disabled={!o.shares}>
              {paymentOptionLabel(o, ar)}
            </option>
          ))}
        </select>
      </label>
      {options.some((o) => o.advanceRange) && (
        <p className="qp-guidance">
          {l(
            'The recorded advance range is guidance. Enter an exact percentage and define the remaining payments below.',
            'النسبة المقدمة المسجلة نطاق إرشادي. أدخل نسبة محددة وحدد الدفعات المتبقية أدناه.'
          )}
        </p>
      )}
      {!plan ? (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onChange({ stages: [{ percent: 100, event: 'unspecified' }] })
          }
        >
          {l('Set payment schedule', 'تحديد جدول الدفعات')}
        </Button>
      ) : (
        <>
          <div className="qp-payment-table">
            <div className="qp-payment-head">
              <span>{l('Share', 'النسبة')}</span>
              <span>{l('Payment event', 'موعد الدفع')}</span>
              <span>{l('Amount', 'المبلغ')}</span>
              <span />
            </div>
            {plan.stages.map((s, i) => (
              <div className="qp-payment-row" key={i}>
                <label>
                  <span className="sr-only">
                    {l('Percentage', 'النسبة') + ' ' + (i + 1)}
                  </span>
                  <div className="qp-percent">
                    <PercentageField
                      label={l('Percentage', 'النسبة') + ' ' + (i + 1)}
                      value={s.percent}
                      disabled={disabled}
                      onChange={(percent) => patch(i, { percent })}
                    />
                    <span>%</span>
                  </div>
                </label>
                <div>
                  <label>
                    <span className="sr-only">
                      {l('Payment event', 'موعد الدفع') + ' ' + (i + 1)}
                    </span>
                    <select
                      aria-label={
                        l('Payment event', 'موعد الدفع') + ' ' + (i + 1)
                      }
                      value={s.event}
                      disabled={disabled}
                      onChange={(e) =>
                        patch(i, { event: e.target.value as typeof s.event })
                      }
                    >
                      {PAYMENT_EVENTS.map((event) => (
                        <option key={event} value={event}>
                          {eventLabel(event, ar)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {s.event === 'custom' && (
                    <Input
                      aria-label={l(
                        'Custom payment event',
                        'موعد الدفع المخصص'
                      )}
                      value={s.label ?? ''}
                      disabled={disabled}
                      onChange={(e) => patch(i, { label: e.target.value })}
                    />
                  )}
                </div>
                <strong dir="auto">{money(amounts[i])}</strong>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={l('Remove instalment', 'حذف الدفعة')}
                  disabled={disabled || plan.stages.length === 1}
                  onClick={() =>
                    onChange({
                      ...plan,
                      stages: plan.stages.filter((_, j) => i !== j),
                    })
                  }
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
          <div className="qp-payment-footer">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || plan.stages.length >= 12}
              onClick={() =>
                onChange({
                  ...plan,
                  stages: [
                    ...plan.stages,
                    { percent: Math.max(0, 100 - sum), event: 'unspecified' },
                  ],
                })
              }
            >
              {l('+ Add instalment', '+ إضافة دفعة')}
            </Button>
            <span
              className={
                validPaymentPlan(plan, true) ? 'qp-good' : 'qp-incomplete'
              }
            >
              {validPaymentPlan(plan, true)
                ? l('Schedule complete', 'جدول الدفعات مكتمل')
                : l(
                    'Complete the payment events and allocate 100%.',
                    'أكمل مواعيد الدفعات ووزع نسبة 100%.'
                  )}
            </span>
          </div>
          <TermPresetField
            label={l('Additional payment notes', 'ملاحظات الدفع الإضافية')}
            value={plan.notes ?? ''}
            options={options.flatMap((o) => {
              const p = optionPlan(o);
              return p?.notes ? [p.notes] : [];
            })}
            disabled={disabled}
            optional
            onChange={(notes) => onChange({ ...plan, notes })}
          />
        </>
      )}
    </section>
  );
}

function PercentageField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const ar = useLocale() === 'ar',
    [custom, setCustom] = useState(false);
  const shares = [0, 10, 20, 25, 30, 40, 50, 60, 65, 70, 75, 80, 90, 100];
  const editing = custom || !shares.includes(value);
  return (
    <div className="qp-share-choice">
      <select
        aria-label={label}
        value={editing ? 'custom' : String(value)}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === 'custom') setCustom(true);
          else {
            setCustom(false);
            onChange(Number(e.target.value));
          }
        }}
      >
        {shares.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="custom">{ar ? 'مخصص' : 'Custom'}</option>
      </select>
      {editing && (
        <Input
          aria-label={label + (ar ? ' — مخصص' : ' — custom')}
          type="number"
          min="0"
          max="100"
          step="any"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
    </div>
  );
}
