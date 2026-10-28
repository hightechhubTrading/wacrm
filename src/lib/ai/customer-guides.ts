export const GUIDE_SECTION_KEYS = [
  'explanation',
  'options',
  'selection',
  'next_question',
  'faq',
] as const;
export type GuideSections = Record<(typeof GUIDE_SECTION_KEYS)[number], string>;
export const EMPTY_GUIDE: GuideSections = {
  explanation: '',
  options: '',
  selection: '',
  next_question: '',
  faq: '',
};
export const GUIDE_SCOPE =
  'GENERAL PRODUCT EDUCATION: category meanings and conditional buying guidance. This guide does not establish company availability, exact specifications, prices, warranties, performance ratings or delivery commitments. Use approved exact-product facts for company-specific claims.';
export const GUIDE_HEADINGS: Record<keyof GuideSections, string> = {
  explanation: 'Explain simply',
  options: 'Compare options',
  selection: 'Help choose',
  next_question: 'Useful next question',
  faq: 'Common questions',
};
export interface CustomerGuide {
  id: string;
  product_id: string;
  title: string;
  status: 'draft' | 'approved';
  document_type: 'customer_guide';
  guide_sections: GuideSections;
  source_url: string | null;
  source_notes: string;
  updated_at: string;
}
export interface GuideProduct {
  id: string;
  name: string;
  parent_id: string | null;
  kind: string;
  superseded_by?: string | null;
}
export function parseGuideSections(
  value: unknown,
  approved = false
): GuideSections {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Complete the customer guide sections.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (k) => !GUIDE_SECTION_KEYS.includes(k as keyof GuideSections)
    )
  )
    throw new Error('Unknown customer guide section.');
  const result = { ...EMPTY_GUIDE };
  for (const key of GUIDE_SECTION_KEYS) {
    const text = input[key];
    if (typeof text !== 'string' || text.length > 6000)
      throw new Error(
        'Each guide section must be text, up to 6,000 characters.'
      );
    result[key] = text.trim();
    if ((key === 'explanation' || approved) && !result[key])
      throw new Error(
        approved
          ? 'Complete all five sections before approving the guide.'
          : 'Add a simple product explanation.'
      );
  }
  return result;
}
export function renderGuideContent(sections: GuideSections): string {
  return (
    GUIDE_SCOPE +
    '\n\n' +
    GUIDE_SECTION_KEYS.map(
      (k) => '## ' + GUIDE_HEADINGS[k] + '\n' + sections[k]
    ).join('\n\n')
  );
}
/** Nearest first. Incomplete/cyclic/superseded branches fail closed. Review status is separate from educational scope. */
export function guideProductChain(
  products: GuideProduct[],
  id: string
): GuideProduct[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const chain: GuideProduct[] = [];
  let current = byId.get(id);
  while (current) {
    if (seen.has(current.id) || current.superseded_by) return [];
    seen.add(current.id);
    chain.push(current);
    if (!current.parent_id) return chain;
    current = byId.get(current.parent_id);
  }
  return [];
}
export function nearestCustomerGuide(
  products: GuideProduct[],
  id: string,
  guides: CustomerGuide[]
): CustomerGuide | null {
  for (const p of guideProductChain(products, id)) {
    const guide = guides.find((g) => g.product_id === p.id);
    if (guide) return guide;
  }
  return null;
}
