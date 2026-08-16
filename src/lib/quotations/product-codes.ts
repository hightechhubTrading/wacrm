// Shared by quotation-list.tsx (standalone "New Quotation" creation) and
// quotations-dialog.tsx (deal-card creation) -- both fetch
// GET /api/quotation-product-codes (Task 15's admin-managed settings
// table) instead of hardcoding a code list, so a code an admin adds in
// Settings is selectable everywhere a quotation is created without a
// redeploy.
export interface ProductCode {
  code: string;
  label: string;
}

// Picks a sane default selection once the fetched list arrives: keep
// whatever the caller already has selected if it's still a real code in
// the new list, otherwise fall back to the first code, or '' if the
// account has no codes seeded yet (059's per-account seed step is not
// wired up as of this wave -- a brand-new account can genuinely have
// zero rows here). Callers disable creation entirely on ''.
export function pickDefaultProductCode(codes: ProductCode[], current: string): string {
  if (current && codes.some((c) => c.code === current)) return current;
  return codes[0]?.code ?? '';
}
