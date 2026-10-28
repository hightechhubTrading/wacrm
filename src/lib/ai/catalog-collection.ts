/** Collection answers are staff work, never approved product evidence. */
export interface CatalogQuestion {
  id: string;
  product_id: string | null;
  question: string;
  answer: string;
  evidence: string;
  confirmed_by: string;
  confirmed_on: string | null;
  status: 'open' | 'answered' | 'closed';
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseCatalogQuestion(
  body: unknown
): Partial<Omit<CatalogQuestion, 'id'>> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Enter a question.');
  const input = body as Record<string, unknown>;
  const out: Record<string, string | null> = {};
  for (const [key, max] of Object.entries({
    question: 2000,
    answer: 12000,
    evidence: 2000,
    confirmed_by: 200,
  })) {
    if (!(key in input)) continue;
    const value = input[key];
    if (
      typeof value !== 'string' ||
      value.length > max ||
      (key === 'question' && !value.trim())
    )
      throw new Error(`Invalid ${key}.`);
    out[key] = value.trim();
  }
  if ('product_id' in input) {
    if (
      input.product_id !== null &&
      (typeof input.product_id !== 'string' || !uuid.test(input.product_id))
    )
      throw new Error('Choose a valid product.');
    out.product_id = input.product_id as string | null;
  }
  if ('status' in input) {
    if (!['open', 'answered', 'closed'].includes(String(input.status)))
      throw new Error('Choose a collection status.');
    out.status = String(input.status);
  }
  if ('confirmed_on' in input) {
    const v = input.confirmed_on;
    if (
      v !== null &&
      (typeof v !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v)
    )
      throw new Error('Enter a valid confirmation date.');
    out.confirmed_on = v as string | null;
  }
  return out as Partial<Omit<CatalogQuestion, 'id'>>;
}

export function catalogGaps(p: {
  kind: string;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  specifications?: string;
  files?: unknown[];
}) {
  if (p.kind === 'family') return [];
  const gaps: ('price' | 'specifications' | 'files')[] = [];
  if (p.price_min === null || p.price_max === null || !p.price_unit)
    gaps.push('price');
  if (!p.specifications?.trim()) gaps.push('specifications');
  if (!p.files?.length) gaps.push('files');
  return gaps;
}

/** Keep a product next to its variants instead of sorting by edit time. */
export function collectionProductRows<
  T extends {
    id: string;
    name: string;
    parent_id: string | null;
    kind: string;
  },
>(products: T[]): T[] {
  const result: T[] = [];
  const visited = new Set<string>();
  const walk = (p: T) => {
    if (visited.has(p.id)) return;
    visited.add(p.id);
    if (p.kind !== 'family') result.push(p);
    products
      .filter((c) => c.parent_id === p.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(walk);
  };
  products
    .filter((p) => !p.parent_id || !products.some((q) => q.id === p.parent_id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(walk);
  products.filter((p) => !visited.has(p.id)).forEach(walk);
  return result;
}
