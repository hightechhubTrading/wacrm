import type {
  KnowledgeRecord,
  KnowledgeSnapshot,
  QuotationKnowledge,
} from './types';
import type { QuotationItemToSave } from '../crud';
import { validConfiguration } from './validation';
export function dimensionsCm(
  item: Pick<QuotationItemToSave, 'sizeW' | 'sizeH' | 'measurementUnit'>
) {
  const factor = { mm: 0.1, cm: 1, m: 100 }[item.measurementUnit ?? 'mm'];
  if (!factor || !Number.isFinite(item.sizeW) || !Number.isFinite(item.sizeH))
    throw Error('Enter valid dimensions and units.');
  return {
    width: Number(item.sizeW) * factor,
    height: Number(item.sizeH) * factor,
  };
}
export function recordLabel(r: KnowledgeRecord) {
  return (
    r.data.item_en ||
    r.data.product_en ||
    r.data.description ||
    r.data.component ||
    r.data.client_key ||
    r.data.Client ||
    r.data.file ||
    r.data.item ||
    r.data.product ||
    r.record_key
  );
}
export function snapshot(r: KnowledgeRecord): KnowledgeSnapshot {
  if (
    r.review_status !== 'approved' ||
    !r.reviewed_at ||
    !validConfiguration(r.configuration)
  )
    throw Error('This source needs preparation.');
  return {
    recordId: r.id,
    batchId: r.batch_id,
    source: r.source,
    sourceRow: r.source_row,
    reviewVersion: r.review_version,
    reviewedAt: r.reviewed_at,
    capturedAt: new Date().toISOString(),
    label: recordLabel(r),
    configuration: structuredClone(r.configuration),
  };
}
export function calculatePrice(
  r: KnowledgeRecord,
  item: QuotationItemToSave,
  options = { fifthSheet: false, manual: false }
) {
  if (!['price', 'grid', 'product'].includes(r.kind))
    throw Error('This source is not a selling-price rule.');
  const s = snapshot(r),
    p = r.configuration.pricing;
  if (
    r.configuration.catalogItemId &&
    item.productId !== r.configuration.catalogItemId
  )
    throw Error('This rule belongs to a different catalog product.');
  if (!p)
    throw Error('Set the calculation rule for this documented price first.');
  if (
    p.column &&
    p.column !== 'confirmed' &&
    (!r.data[`col_${p.column}`] || Number(r.data[`col_${p.column}`]) !== p.rate)
  )
    throw Error(
      'The rate differs from its source column. Review it as a directly confirmed rate.'
    );
  if (
    [item.sizeW, item.sizeH].some(
      (v) => v !== undefined && (!Number.isFinite(v) || v < 0)
    )
  )
    throw Error('Invalid dimensions.');
  let price = p.rate;
  let unit = 'piece';
  const { width, height } = dimensionsCm({
    ...item,
    sizeW: item.sizeW ?? 0,
    sizeH: item.sizeH ?? 0,
  });
  if (p.basis !== 'piece' && width <= 0)
    throw Error('Enter the opening width.');
  if (['area', 'grid'].includes(p.basis) && height <= 0)
    throw Error('Enter the opening height.');
  if (
    (p.minWidthCm !== undefined && width < p.minWidthCm) ||
    (p.maxWidthCm !== undefined && width > p.maxWidthCm) ||
    (p.minHeightCm !== undefined && height < p.minHeightCm) ||
    (p.maxHeightCm !== undefined && height > p.maxHeightCm)
  )
    throw Error('Dimensions are outside this approved rule.');
  if (
    p.basis === 'grid' &&
    (width < (p.minWidthCm ?? p.maxWidthCm!) ||
      height < (p.minHeightCm ?? p.maxHeightCm!))
  )
    throw Error('Select an approved grid cell for these dimensions.');
  if (p.basis === 'area') {
    unit = 'm2';
    const area = (width * height) / 10000;
    price *= Math.max(area, p.minimumAreaM2 ?? 0) / area;
  }
  if (p.basis === 'width') price *= width / 100;
  if (options.fifthSheet) {
    if (p.fifthSheetQar === undefined)
      throw Error('Fifth-sheet adjustment needs approval.');
    price += p.fifthSheetQar / (unit === 'm2' ? (width * height) / 10000 : 1);
  }
  if (options.manual) {
    if (p.manualAdjustmentQar === undefined)
      throw Error('Manual adjustment needs approval.');
    price +=
      p.manualAdjustmentQar / (unit === 'm2' ? (width * height) / 10000 : 1);
  }
  if (price < 0 || !Number.isFinite(price))
    throw Error('Invalid calculated price.');
  price = Math.round(price * 1e6) / 1e6;
  return {
    unitPrice: price,
    unit,
    snapshot: {
      ...s,
      appliedUnitPrice: price,
      appliedUnit: unit,
      input: {
        width: item.sizeW ?? 0,
        height: item.sizeH ?? 0,
        measurementUnit: item.measurementUnit ?? 'mm',
        qty: item.qty ?? 1,
        ...options,
      },
    },
  };
}
export function stalePrice(item: QuotationItemToSave, s: KnowledgeSnapshot) {
  const i = s.input;
  return (
    (s.configuration.catalogItemId !== undefined &&
      item.productId !== s.configuration.catalogItemId) ||
    !i ||
    item.unitPrice !== s.appliedUnitPrice ||
    item.unit !== s.appliedUnit ||
    (item.sizeW ?? 0) !== i.width ||
    (item.sizeH ?? 0) !== i.height ||
    (item.measurementUnit ?? 'mm') !== i.measurementUnit ||
    (item.qty ?? 1) !== i.qty
  );
}
export function knowledgeExportError(
  items: QuotationItemToSave[],
  k?: QuotationKnowledge
) {
  return k &&
    Object.entries(k.prices).some(([id, s]) => {
      const item = items.find((i) => i.id === id);
      return item && stalePrice(item, s);
    })
    ? 'staleKnowledgePrice'
    : null;
}
export interface BomLine {
  itemId: string;
  component: string;
  quantity: number | null;
  unit: string;
  cutCm?: number;
  confidence: 'source' | 'assumed' | 'missing';
}
export function shutter55Bom(item: QuotationItemToSave, automatic: boolean) {
  const { width: w, height: h } = dimensionsCm(item);
  const count = item.qty ?? 1;
  if (
    w <= 10 ||
    h <= 25 ||
    w > 1000 ||
    h > 1000 ||
    !Number.isInteger(count) ||
    count <= 0
  )
    throw Error(
      'Enter positive whole shutter quantities and dimensions above 10 × 25 cm; engineering review is required outside 10 m.'
    );
  const slats = Math.ceil(h / 5.5 - 2);
  const line = (
    itemId: string,
    component: string,
    quantity: number | null,
    unit: string,
    confidence: BomLine['confidence'],
    cutCm?: number
  ): BomLine => ({
    itemId,
    component,
    quantity: quantity === null ? null : quantity * count,
    unit,
    confidence,
    cutCm,
  });
  return {
    slatsPerShutter: slats,
    areaM2: ((w * h) / 10000) * count,
    complete: false,
    lines: [
      line(
        'HT-WSC-002',
        '55 mm slats',
        (slats * (w - 8)) / 100,
        'm',
        'source',
        w - 8
      ),
      line(
        'BOTTOM-BAR',
        'Bottom bar',
        count ? 1 : 0,
        'piece',
        'assumed',
        w - 8
      ),
      line('HT-WSC-012', 'Slat end plugs', slats * 2, 'piece', 'assumed'),
      line('HT-WSC-005', 'Guide channels', 2, 'piece', 'source', h - 22),
      line('HT-WSC-019', '250 mm box, 45°', 1, 'piece', 'source', w - 1),
      line('HT-WSC-008', 'Box end caps', 1, 'pair', 'assumed'),
      line(
        'HT-WSC-009',
        'Ø60 tube; wall thickness unconfirmed',
        1,
        'piece',
        'source',
        w - 10
      ),
      line('HT-WSC-026', 'Tube cap with bearing case', 1, 'piece', 'assumed'),
      line('HT-WSC-027', 'Bearing 28 × 12 mm', 1, 'piece', 'assumed'),
      line('HT-WSC-013', 'Security springs', null, 'piece', 'missing'),
      ...(automatic
        ? [
            line(
              'MOTOR',
              'Tubular motor; select torque/model',
              1,
              'piece',
              'source'
            ),
            line('CONTROL', 'Receiver and remote', 1, 'set', 'assumed'),
          ]
        : [
            line(
              'MANUAL',
              'Manual operation set; details unconfirmed',
              1,
              'set',
              'missing'
            ),
          ]),
      line('FIXINGS', 'Brackets, fixings and seal', null, 'set', 'missing'),
    ],
  };
}
export function landedUnitCost(r: KnowledgeRecord) {
  if (
    r.review_status !== 'approved' ||
    !validConfiguration(r.configuration) ||
    !r.configuration.supplierCost
  )
    throw Error(
      'Confirm currency, units, exchange rate and landed costs first.'
    );
  const c = r.configuration.supplierCost;
  return (
    (c.price * c.fxToQar +
      c.freightQarPerUnit +
      c.dutyQarPerUnit +
      c.clearingQarPerUnit) /
    (c.unit === 'm' ? c.metresPerPricedUnit : 1)
  );
}
export function estimateCost(
  lines: { quantity: number | null; rate: number | null }[],
  extras: {
    labour: number | null;
    installation: number | null;
    delivery: number | null;
    other: number | null;
  },
  sellingTotal: number
) {
  const all = [
    ...lines.map((l) =>
      l.quantity === null || l.rate === null ? null : l.quantity * l.rate
    ),
    ...Object.values(extras),
  ];
  const invalid = all.some((v) => v !== null && (!Number.isFinite(v) || v < 0));
  if (invalid) throw Error('Costs must be finite and non-negative.');
  const partial = all.reduce<number>((n, v) => n + (v ?? 0), 0);
  const complete = !all.includes(null) && all.length > 4;
  return {
    complete,
    partial,
    total: complete ? partial : null,
    marginQar: complete ? sellingTotal - partial : null,
    marginPercent:
      complete && sellingTotal > 0
        ? ((sellingTotal - partial) / sellingTotal) * 100
        : null,
  };
}
