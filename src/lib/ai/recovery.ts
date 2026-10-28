import type { SalesEvidence } from './typesafe/sales';
import { customerLanguageScript } from './query';

/** A narrow fallback for the audited ambiguous shutter-price case, still fully verified. */
export function shutterClarification(evidence: SalesEvidence): string | null {
  const turns = evidence.messages.filter((m) => m.role === 'user');
  const text = [
    ...turns.map((m) => m.content),
    ...(evidence.memory?.statements.map((s) => s.text) ?? []),
  ].join('\n');
  if (!/(?:sh[au]t(?:t?er|ar)|شتر|شاتر)/i.test(text)) return null;
  // Never re-ask a category already supplied by the customer. Ignore the generic ad's
  // "shutter doors" wording: that ad itself is the ambiguity seen in the audit.
  if (
    /(?:window|garage|shop|store|كراج|محل|نافذ|نوافذ|درايش|دريش|كبين|كابينة)/i.test(
      text
    )
  )
    return null;
  if (
    /(?:shutters?\s+for\s+(?:the\s+)?doors?|(?:need|want)\s+(?:a\s+)?shutter\s+door|شتر\s+(?:للأبواب|للابواب|باب|أبواب|ابواب))/i.test(
      text
    )
  )
    return null;
  const prior = evidence.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content)
    .join('\n');
  if (/(?:windows?.*(?:or|\/).*garage|نوافذ.*(?:أم|او|أو).*كراج)/i.test(prior))
    return null;
  return customerLanguageScript(evidence.messages) === 'arabic'
    ? 'تقصد شتر للنوافذ أو باب شتر لكراج أو محل؟'
    : 'Do you mean window shutters, or a shutter door for a garage or shop?';
}
