import { describe, it, expect } from 'vitest';
import {
  paymentAmounts,
  mergePaymentOptions,
  paymentOptions,
  optionPlan,
  validPaymentPlan,
  legacyPaymentPlan,
  paymentPlanText,
} from './payment-plan';
describe('structured company payment terms', () => {
  it('normalizes equivalent spelling and preserves distinct payment events', () => {
    expect(paymentOptions('100% advance')).toEqual(
      paymentOptions('100 % upfront')
    );
    expect(paymentOptions('60/30/10')).toEqual(paymentOptions('60 / 30 / 10'));
    const delivery = optionPlan(
      paymentOptions('60% advance, 30% on delivery, 10% on completion')[0]
    );
    expect(delivery?.stages.map((s) => s.event)).toEqual([
      'acceptance',
      'delivery',
      'completion',
    ]);
    const before = optionPlan(
      paymentOptions(
        '60% advance, 30% before installation, 10% on completion'
      )[0]
    );
    expect(before?.stages[1].event).toBe('before_installation');
    expect(before).not.toEqual(delivery);
  });
  it('keeps ranges as guidance while preserving separate fixed options', () => {
    const options = paymentOptions('100% advance (small) or 60-70% advance');
    expect(options).toHaveLength(2);
    expect(options.find((o) => o.advanceRange)?.advanceRange).toEqual([60, 70]);
    expect(optionPlan(options.find((o) => o.advanceRange)!)).toBeUndefined();
    expect(
      validPaymentPlan(optionPlan(options.find((o) => o.shares)!), true)
    ).toBe(true);
  });
  it('allows unfinished drafts but rejects incomplete or malformed schedules for issue', () => {
    const plan = optionPlan(paymentOptions('60/30/10')[0]);
    expect(validPaymentPlan(plan)).toBe(true);
    expect(validPaymentPlan(plan, true)).toBe(false);
    expect(
      validPaymentPlan({ stages: [{ percent: 100, event: 'custom' }] }, true)
    ).toBe(false);
    expect(
      validPaymentPlan({ stages: [{ percent: 90, event: 'acceptance' }] }, true)
    ).toBe(false);
    expect(
      validPaymentPlan({ stages: [{ percent: -1, event: 'acceptance' }] })
    ).toBe(false);
    expect(
      validPaymentPlan({ stages: [{ percent: 100, event: 'invented' }] })
    ).toBe(false);
    expect(
      validPaymentPlan(
        {
          stages: [
            {
              percent: 100,
              event: 'custom',
              label: 'After signed site inspection',
            },
          ],
        },
        true
      )
    ).toBe(true);
  });
  it('retains the actual milestone when reading a legacy schedule', () => {
    const plan = legacyPaymentPlan({
      advance: 70,
      delivery: 30,
      completion: 0,
      deliveryTrigger: 'before_installation',
    });
    expect(plan.stages).toHaveLength(2);
    expect(paymentPlanText(plan)).toContain('Before installation');
    expect(validPaymentPlan(plan, true)).toBe(true);
  });
  it('does not borrow an advance event from a separate alternative', () => {
    const choices = paymentOptions('100% advance (villa) or 70/30');
    expect(choices.find((o) => o.shares?.length === 2)?.events).toEqual([
      'unspecified',
      'unspecified',
    ]);
  });
  it('merges equivalent schedules and labels differing milestones distinctly', () => {
    const a = paymentOptions('60/30/10')[0],
      b = paymentOptions('60% advance, 30% on delivery, 10% on completion')[0],
      c = paymentOptions(
        '60% advance, 30% before installation, 10% on completion'
      )[0];
    expect(mergePaymentOptions([a, b])).toHaveLength(1);
    expect(mergePaymentOptions([a, b])[0].events).toEqual(b.events);
    expect(mergePaymentOptions([b, c])).toHaveLength(2);
  });
  it('allocates cents exactly without inventing instalment money', () => {
    const p = {
      stages: [
        { percent: 50, event: 'acceptance' as const },
        { percent: 50, event: 'completion' as const },
      ],
    };
    expect(paymentAmounts(p, 0.05)).toEqual([0.03, 0.02]);
    expect(
      paymentAmounts({ stages: [{ percent: 70, event: 'acceptance' }] }, 100)
    ).toEqual([70]);
  });
});
