import type { CatalogueProduct } from './catalogue';
import type { QuotationItemToSave } from './crud';
import { nextItemCode } from './item-editor';
export interface ItemOptions {
  drawingReference?: string;
  selections?: Record<string, string>;
}
export interface ProductField {
  key: string;
  en: string;
  ar: string;
  options?: string[];
}
export interface ProductProfile {
  code: string;
  unit?: string;
  fields: ProductField[];
}
export function productProfile(
  product: Pick<
    CatalogueProduct,
    | 'name'
    | 'sku'
    | 'familyName'
    | 'productCode'
    | 'inventory_type'
    | 'unit_of_measure'
    | 'price_unit'
    | 'specifications'
    | 'description'
  >
): ProductProfile {
  const skuCode = product.sku?.match(/^([A-Z]+)-/)?.[1];
  const familyCode =
    skuCode &&
    [
      'WS',
      'RSD',
      'SEC',
      'PG',
      'AL',
      'GL',
      'UPVC',
      'PIV',
      'SD',
      'FSD',
      'SL',
      'SW',
      'GB',
      'SP',
      'HSD',
      'MOT',
      'GTR',
      'SVC',
      'MAT',
    ].includes(skuCode)
      ? skuCode
      : undefined;
  const inferred = /Electroll|Electroof|GTR/i.test(
    product.name + ' ' + product.familyName
  )
    ? 'GTR'
    : /façade/i.test(product.name)
      ? 'AL'
      : /glass|glaz|skylight/i.test(product.name)
        ? 'GL'
        : undefined;
  const code =
    product.inventory_type === 'service'
      ? 'SVC'
      : product.inventory_type === 'equipment'
        ? 'MOT'
        : product.inventory_type === 'component'
          ? 'MAT'
          : familyCode && familyCode !== 'ITEM'
            ? familyCode
            : product.productCode?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ||
              inferred ||
              'ITEM';
  const unit =
    product.unit_of_measure ??
    {
      per_square_meter: 'm2',
      per_meter: 'm',
      per_item: 'piece',
      per_project: 'job',
    }[product.price_unit ?? ''] ??
    (code === 'WS' ? 'm2' : undefined);
  const fields: ProductField[] = [];
  if (product.inventory_type === 'product') {
    const text = product.specifications + ' ' + product.description;
    const colors =
      code === 'WS' || /white.*beige|beige.*white/i.test(text)
        ? ['White', 'Beige', 'Custom']
        : undefined;
    fields.push({
      key: 'finish',
      en: 'Colour / finish',
      ar: 'اللون / التشطيب',
      options: colors,
    });
    if (code === 'WS')
      fields.push({ key: 'profile', en: 'Slat profile', ar: 'مقطع الشرائح' });
    if (code === 'PIV')
      fields.push(
        { key: 'design', en: 'Design reference', ar: 'مرجع التصميم' },
        { key: 'handle', en: 'Handle / lock', ar: 'المقبض / القفل' }
      );
    if (['AL', 'UPVC', 'GL', 'GLF', 'SHW'].includes(code))
      fields.push(
        { key: 'opening', en: 'Opening arrangement', ar: 'طريقة الفتح' },
        { key: 'glazing', en: 'Glazing specification', ar: 'مواصفات الزجاج' }
      );
  }
  return { code, unit, fields };
}
export function productItemReference(
  product: CatalogueProduct,
  items: QuotationItemToSave[]
): string {
  return nextItemCode(items, productProfile(product).code);
}
/** Parents describe ranges; only leaves/configurations become quote lines. */
export function sellableCatalogue(
  items: CatalogueProduct[]
): CatalogueProduct[] {
  const parents = new Set(items.map((p) => p.parent_id).filter(Boolean));
  return items.filter((p) => p.kind !== 'family' && !parents.has(p.id));
}
export function customerSpecification(text: string): string[] {
  return text
    .split(/\n|(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[•\s]+/, '').trim())
    .filter(
      (s) =>
        s &&
        !/^(?:Current observed|التكوين الحالي المرصود|Source:|المصدر:|Recorded |Observed |Offer payments:|Payment|Delivery|Warranty|Model-specific commercial|Equipment and installation details|.*not yet recorded|.*remains? (?:open|a separate)|.*are recorded|.*in the source)/i.test(
          s
        )
    );
}

export function catalogueChoices(products: CatalogueProduct[]) {
  const groups = new Map<string, CatalogueProduct[]>();
  for (const product of products) {
    const grouped =
      product.inventory_type === 'product' && product.name.includes(' · ');
    const key = grouped
      ? `${product.parent_id}:${product.name.split(' · ')[0]}`
      : product.id;
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  return [...groups.entries()].flatMap(([key, rows]) =>
    rows.length > 2
      ? [{ key, title: rows[0].name.split(' · ')[0], products: rows }]
      : rows.map((p) => ({ key: p.id, title: p.name, products: [p] }))
  );
}

export function quotationDelivery(
  items: QuotationItemToSave[],
  options: Record<string, ItemOptions>
) {
  const lines = items.filter(
    (i) =>
      i.itemType === 'line' &&
      !i.parentItemId &&
      options[i.id]?.selections?.deliveryPeriod
  );
  return lines
    .map(
      (i) =>
        (lines.length > 1 ? (i.itemCode ?? '') + ': ' : '') +
        options[i.id].selections!.deliveryPeriod
    )
    .join('\n');
}
