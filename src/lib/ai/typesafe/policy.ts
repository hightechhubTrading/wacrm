import type { ChatMessage } from '../types';

// Initial conservative thresholds, evaluated on synthetic fixtures, not claims
// of domain-wide calibration. Keep all raw probabilities in the audit record.
export const SUPPORTED_MIN = 0.85;
export const HANDOFF_MIN = 0.9;
export const INTENT_MIN = 0.65;
export const QUESTION_VERSION = 'sales-v8-useful-recovery';

export const INTENTS = {
  product: 'Ask about products, options, suitability or examples.',
  repair: 'Repair, maintenance or troubleshooting of an installed product.',
  supplier:
    'Offer goods/services or seek work rather than buy from the business.',
  wrong_contact:
    'Explicitly say this is the wrong contact or the message was accidental.',
  deferred:
    'Explicitly postpone purchasing and say they will contact the business later.',
  pricing: 'Ask for a price, estimate, quote or payment terms.',
  ready_to_buy:
    'Explicitly request a quotation, site visit or next purchasing step.',
  existing_order:
    'Ask about an existing order, installation or service appointment.',
  complaint: 'Report an unresolved problem, dissatisfaction or failed service.',
  human: 'Ask to talk to a human salesperson or team member.',
  information:
    'Ask for business address, hours, contact details or other general information.',
  unclear:
    'Greeting, ambiguous message, several equally plausible intents or no match.',
} as const;
export type SalesIntent = keyof typeof INTENTS;

const GUIDANCE: Record<SalesIntent, string> = {
  product:
    'Answer the product question first. Explain accurate general category differences and conditional tradeoffs; keep exact company claims grounded in approved evidence. A basic comparison does not require dimensions. Offer a relevant known option and ask at most one useful unanswered preference or necessary detail.',
  repair:
    'Acknowledge the existing product and symptom. Ask only the next missing symptom or site detail; do not restart new-product qualification. The team must confirm visit times and fees.',
  supplier:
    'Treat this as a job/supplier enquiry, not a purchase lead. Acknowledge briefly; do not ask opening dimensions, quote products or offer a site visit. Never invent vacancies, an HR contact, or a promise that a CV has been reviewed. If a CV was supplied, acknowledge receipt only. Use an approved non-sales contact if provided; otherwise explain that hiring/supplier decisions need the business team without creating a sales quotation or inspection task.',
  wrong_contact:
    'Acknowledge briefly. Do not upsell, collect measurements or create sales follow-up work.',
  deferred:
    'Respect the stated timing. Do not push for a visit or another qualification; keep the details for when the customer returns.',
  pricing:
    'Give a supported estimate with its unit and caveats when available. Otherwise ask only the next missing pricing detail. Do not repeat already answered questions. Preserve the exact opening count and latest correction; quote comparisons must use matching scope. Never invent discounts or cheaper specifications.',
  ready_to_buy:
    'Acknowledge the requested next step. Ask one essential missing detail, or connect the team for the quotation or visit. Do not claim anything has been booked or approved.',
  existing_order:
    'Acknowledge the existing order. Do not restart lead qualification or invent status; connect the team when recorded status is unavailable.',
  complaint:
    'Acknowledge the specific concern without defensiveness or upselling. Avoid repeated clarifying questions and involve the team when necessary.',
  human:
    'Respect the request for a human without imposing another qualification question.',
  information:
    'Answer directly from the provided business facts. Do not add unrelated sales questions.',
  unclear:
    'Ask one short natural clarification only if needed; do not assume a product or purchase commitment.',
};

export function salesGuidance(intent: SalesIntent, confidence: number): string {
  return confidence >= INTENT_MIN ? GUIDANCE[intent] : GUIDANCE.unclear;
}

/** Captions and file/location markers are observations, not stated lead values. */
export function customerStatements(messages: ChatMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'user')
    .filter((m) => !m.attachmentState)
    .map((m) => m.content.replace(/(?:^|\n)\[Image: [\s\S]*\]$/, '').trim())
    .filter(
      (text) =>
        text &&
        !/^\[(?:Location shared|File sent|Video sent|Audio received|Unsupported message type)/.test(
          text
        )
    );
}

export function isProbability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
