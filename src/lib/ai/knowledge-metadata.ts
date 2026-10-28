import { validSourceUrl } from './catalog';
export const KNOWLEDGE_FIELDS =
  'document_type, status, topic, product_id, source_url, source_notes';
export function parseKnowledgeMetadata(
  body: Record<string, unknown>
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if ('status' in body) {
    if (!['draft', 'approved'].includes(String(body.status)))
      throw new Error('Choose draft or approved.');
    out.status = String(body.status);
  }
  if ('topic' in body) {
    if (
      !['company', 'product', 'service', 'policy'].includes(String(body.topic))
    )
      throw new Error('Choose a knowledge topic.');
    out.topic = String(body.topic);
  }
  if ('product_id' in body) {
    if (
      body.product_id !== null &&
      (typeof body.product_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.product_id
        ))
    )
      throw new Error('Choose a valid product.');
    out.product_id = body.product_id as string | null;
  }
  if ('source_url' in body) {
    if (!validSourceUrl(body.source_url))
      throw new Error('Use a valid source URL.');
    out.source_url =
      typeof body.source_url === 'string'
        ? body.source_url.trim() || null
        : null;
  }
  if ('source_notes' in body) {
    if (
      typeof body.source_notes !== 'string' ||
      body.source_notes.length > 12000
    )
      throw new Error('Source notes must be text, up to 12,000 characters.');
    out.source_notes = body.source_notes.trim();
  }
  return out;
}
