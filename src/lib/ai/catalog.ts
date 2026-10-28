/** Shared catalog contracts. No prices/specifications are inherited across entries. */
export const CATALOG_FIELDS =
  'superseded_by, parent_id, kind, status, aliases, specifications, limitations, source_url, source_notes';
export type CatalogKind = 'family' | 'product' | 'variant';
export type ReviewStatus = 'draft' | 'approved';
export interface CatalogMetadata {
  superseded_by?: string | null;
  parent_id: string | null;
  kind: CatalogKind;
  status: ReviewStatus;
  aliases: string[];
  specifications: string;
  limitations: string;
  source_url: string | null;
  source_notes: string;
}

export function catalogMetadata(
  row: Partial<CatalogMetadata>
): CatalogMetadata {
  return {
    superseded_by: row.superseded_by ?? null,
    parent_id: row.parent_id ?? null,
    kind: row.kind ?? 'product',
    status: row.status ?? 'approved',
    aliases: row.aliases ?? [],
    specifications: row.specifications ?? '',
    limitations: row.limitations ?? '',
    source_url: row.source_url ?? null,
    source_notes: row.source_notes ?? '',
  };
}

export function validSourceUrl(value: unknown): boolean {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const u = new URL(value);
    return (
      ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
}

/** Validate writes before touching tags or the database. Partial writes validate merged prices in the route. */
export function parseCatalogMetadata(
  body: Record<string, unknown>
): Partial<CatalogMetadata> {
  const out: Partial<CatalogMetadata> = {};
  if ('kind' in body) {
    if (!['family', 'product', 'variant'].includes(String(body.kind)))
      throw new Error('Choose a family, product or variant.');
    out.kind = body.kind as CatalogKind;
  }
  if ('status' in body) {
    if (!['draft', 'approved'].includes(String(body.status)))
      throw new Error('Choose draft or approved.');
    out.status = body.status as ReviewStatus;
  }
  if ('parent_id' in body) {
    if (
      body.parent_id !== null &&
      (typeof body.parent_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.parent_id
        ))
    )
      throw new Error('Choose a valid parent entry.');
    out.parent_id = body.parent_id as string | null;
  }
  if ('aliases' in body) {
    if (
      !Array.isArray(body.aliases) ||
      body.aliases.length > 30 ||
      body.aliases.some((a) => typeof a !== 'string' || a.length > 120)
    )
      throw new Error('Use up to 30 short search names.');
    out.aliases = [
      ...new Set(
        (body.aliases as string[]).map((a) => a.trim()).filter(Boolean)
      ),
    ];
  }
  for (const key of [
    'specifications',
    'limitations',
    'source_notes',
  ] as const) {
    if (key in body) {
      if (typeof body[key] !== 'string' || body[key].length > 12000)
        throw new Error('Catalog notes must be text, up to 12,000 characters.');
      out[key] = body[key].trim();
    }
  }
  if ('source_url' in body) {
    if (!validSourceUrl(body.source_url))
      throw new Error('Use a valid http or https source URL.');
    out.source_url =
      typeof body.source_url === 'string'
        ? body.source_url.trim() || null
        : null;
  }
  return out;
}

export function catalogPriceError(row: {
  price_min?: unknown;
  price_max?: unknown;
  price_unit?: unknown;
  kind?: unknown;
}): string | null {
  const a = row.price_min ?? null,
    b = row.price_max ?? null;
  if (a === null && b === null) return null;
  if (row.kind === 'family')
    return 'Set prices on the exact product or variant, not its family.';
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < 0 ||
    b < a
  )
    return 'Set both non-negative estimate limits; maximum must be at least minimum.';
  if (typeof row.price_unit !== 'string' || !row.price_unit.trim())
    return 'Choose the unit for this estimate.';
  return null;
}

/** Unreviewed ancestors disable the whole branch. Cycles/missing parents fail closed. */
export function approvedCatalogRows<
  T extends {
    id: string;
    parent_id?: string | null;
    status?: string;
    superseded_by?: string | null;
  },
>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.filter((row) => {
    const seen = new Set<string>();
    let current: T | undefined = row;
    while (current) {
      if (
        seen.has(current.id) ||
        current.superseded_by ||
        (current.status ?? 'approved') !== 'approved'
      )
        return false;
      seen.add(current.id);
      if (!current.parent_id) return true;
      current = byId.get(current.parent_id);
    }
    return false;
  });
}
