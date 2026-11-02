'use client';
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
      {options.length > 0 && (
        <div
          className="qp-payment-options"
          aria-label={l(
            'Recorded payment arrangements',
            'ترتيبات الدفع المسجلة'
          )}
        >
          {options.map((o) => (
            <Button
              key={o.key}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || !o.shares}
              onClick={() => onChange(optionPlan(o))}
            >
              {paymentOptionLabel(o, ar)}
            </Button>
          ))}
        </div>
      )}
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
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      aria-label={l('Percentage', 'النسبة') + ' ' + (i + 1)}
                      value={s.percent}
                      disabled={disabled}
                      onChange={(e) =>
                        patch(i, { percent: Number(e.target.value) })
                      }
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
          <label>
            {l('Additional payment notes', 'ملاحظات الدفع الإضافية')}
            <textarea
              rows={2}
              value={plan.notes ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ ...plan, notes: e.target.value })}
            />
          </label>
        </>
      )}
    </section>
  );
}
