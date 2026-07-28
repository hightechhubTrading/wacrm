/**
 * Shared helper for the deal-scoped order-info fields (migration 044).
 * A customer's location typically arrives either as a WhatsApp native
 * location share (converted to a Google Maps link by the webhook — see
 * `src/app/api/whatsapp/webhook/route.ts`'s `location` case) or as a
 * pasted Google Maps URL. Either way, `order_location` ends up holding
 * a URL, so every place that renders it (contact sidebar, Order Info
 * dialog, deal form) should offer it as a clickable link instead of
 * inert text.
 */
export function isLikelyUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}
