import { describe, expect, it } from 'vitest';
import { pickDefaultProductCode, type ProductCode } from './product-codes';

// Locks in the fix from the final-review wave-2 report: quotation-list.tsx
// and quotations-dialog.tsx used to hardcode a product-code list
// (PIV/RSD/STL/UPV/GEN, or just "GEN") instead of fetching the real,
// admin-managed list from GET /api/quotation-product-codes. This covers
// the pure selection logic both components now share; the fetch/render
// wiring itself isn't unit-testable in this repo's node-environment
// vitest setup (no jsdom/RTL — every other UI task in this feature has
// limited its tests to pure helper functions for the same reason, e.g.
// quotation-form.test.ts / quotation-item-tree.test.ts).
describe('pickDefaultProductCode', () => {
  const codes: ProductCode[] = [
    { code: 'PIV', label: 'Pivot Door' },
    { code: 'GEN', label: 'General' },
  ];

  it('keeps the current selection when it is still present in the fetched list', () => {
    expect(pickDefaultProductCode(codes, 'GEN')).toBe('GEN');
  });

  it('falls back to the first fetched code when nothing is currently selected', () => {
    expect(pickDefaultProductCode(codes, '')).toBe('PIV');
  });

  it('falls back to the first fetched code when the current selection no longer exists', () => {
    // e.g. an admin deleted the previously-selected code between loads.
    expect(pickDefaultProductCode(codes, 'STL')).toBe('PIV');
  });

  it('returns an empty string when the account has no product codes seeded yet', () => {
    // A brand-new account: 059's per-account seed step is not wired up
    // as of this wave, so this is a real, expected state, not a bug —
    // callers must disable creation rather than default to a code that
    // doesn't exist for this account.
    expect(pickDefaultProductCode([], 'GEN')).toBe('');
  });
});
