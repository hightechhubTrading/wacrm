import type { QuotationDraft } from './workspace';

/** CRM values seed a document snapshot; later CRM/catalog changes never rewrite it. */
export function fillQuotationContext(
  draft: QuotationDraft,
  deal: { id: string; title: string; contact_id: string | null },
  contact?: {
    id: string;
    name: string | null;
    phone: string;
    company?: string | null;
  } | null
): QuotationDraft {
  if (draft.dealId !== deal.id) return draft;
  const result = { ...draft, projectName: draft.projectName || deal.title };
  if (
    !contact ||
    contact.id !== deal.contact_id ||
    (draft.contactId && draft.contactId !== contact.id)
  )
    return result;
  return {
    ...result,
    contactId: draft.contactId || contact.id,
    clientName: draft.clientName || contact.name || '',
    clientPhone: draft.clientPhone || contact.phone,
    clientCompany: draft.clientCompany || contact.company || '',
  };
}
