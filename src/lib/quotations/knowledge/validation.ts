import {
  KNOWLEDGE_KINDS,
  type KnowledgeConfiguration,
  type QuotationKnowledge,
} from './types';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min = 0) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= 1e10;
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
export function validConfiguration(v: unknown): v is KnowledgeConfiguration {
  if (
    !object(v) ||
    Object.keys(v).some(
      (k) =>
        ![
          'catalogItemId',
          'family',
          'pricing',
          'supplierCost',
          'commercial',
        ].includes(k)
    )
  )
    return false;
  if (v.catalogItemId !== undefined && !uuid(v.catalogItemId)) return false;
  if (
    v.family !== undefined &&
    (typeof v.family !== 'string' || v.family.length > 40)
  )
    return false;
  if (v.commercial !== undefined) {
    const c = v.commercial;
    if (
      !object(c) ||
      Object.keys(c).some(
        (k) =>
          ![
            'deliveryTerms',
            'paymentTerms',
            'warrantyTerms',
            'validityDays',
          ].includes(k)
      ) ||
      ['deliveryTerms', 'paymentTerms', 'warrantyTerms'].some(
        (k) =>
          c[k] !== undefined &&
          (typeof c[k] !== 'string' ||
            !(c[k] as string).trim() ||
            (c[k] as string).length > 10000)
      ) ||
      (c.validityDays !== undefined &&
        (!num(c.validityDays, 1) ||
          !Number.isInteger(c.validityDays) ||
          Number(c.validityDays) > 365))
    )
      return false;
  }
  if (v.pricing !== undefined) {
    const p = v.pricing;
    if (
      !object(p) ||
      !['area', 'piece', 'width', 'width_band', 'grid'].includes(
        String(p.basis)
      ) ||
      !num(p.rate) ||
      p.currency !== 'QAR'
    )
      return false;
    if (
      p.column !== undefined &&
      !['O', 'P', 'R', 'S', 'confirmed'].includes(String(p.column))
    )
      return false;
    const numbers = [
      'minWidthCm',
      'maxWidthCm',
      'minHeightCm',
      'maxHeightCm',
      'fifthSheetQar',
      'minimumAreaM2',
    ];
    if (numbers.some((k) => p[k] !== undefined && !num(p[k]))) return false;
    if (
      p.manualAdjustmentQar !== undefined &&
      (typeof p.manualAdjustmentQar !== 'number' ||
        !Number.isFinite(p.manualAdjustmentQar) ||
        Math.abs(p.manualAdjustmentQar) > 1e10)
    )
      return false;
    if (
      Object.keys(p).some(
        (k) =>
          ![
            'basis',
            'rate',
            'currency',
            'column',
            'manualAdjustmentQar',
            ...numbers,
          ].includes(k)
      )
    )
      return false;
    if (
      p.basis === 'width_band' &&
      (!num(p.minWidthCm) ||
        !num(p.maxWidthCm) ||
        Number(p.minWidthCm) > Number(p.maxWidthCm))
    )
      return false;
    if (
      p.basis === 'grid' &&
      (!num(p.maxWidthCm, 0.001) || !num(p.maxHeightCm, 0.001))
    )
      return false;
    if (
      num(p.minWidthCm) &&
      num(p.maxWidthCm) &&
      Number(p.minWidthCm) > Number(p.maxWidthCm)
    )
      return false;
    if (
      num(p.minHeightCm) &&
      num(p.maxHeightCm) &&
      Number(p.minHeightCm) > Number(p.maxHeightCm)
    )
      return false;
  }
  if (v.supplierCost !== undefined) {
    const c = v.supplierCost;
    if (
      !object(c) ||
      typeof c.itemId !== 'string' ||
      !c.itemId.trim() ||
      typeof c.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(c.currency) ||
      !['m', 'piece', 'pair', 'set'].includes(String(c.unit))
    )
      return false;
    if (
      !num(c.price) ||
      !num(c.fxToQar, 0.000001) ||
      !num(c.metresPerPricedUnit, 0.000001) ||
      ['freightQarPerUnit', 'dutyQarPerUnit', 'clearingQarPerUnit'].some(
        (k) => !num(c[k])
      )
    )
      return false;
    if (
      typeof c.effectiveDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.effectiveDate) ||
      !Number.isFinite(Date.parse(c.effectiveDate)) ||
      new Date(c.effectiveDate).toISOString().slice(0, 10) !== c.effectiveDate
    )
      return false;
    if (
      Object.keys(c).some(
        (k) =>
          ![
            'itemId',
            'currency',
            'price',
            'unit',
            'metresPerPricedUnit',
            'fxToQar',
            'freightQarPerUnit',
            'dutyQarPerUnit',
            'clearingQarPerUnit',
            'effectiveDate',
          ].includes(k)
      )
    )
      return false;
  }
  return true;
}
export function validPack(v: unknown): boolean {
  if (
    !object(v) ||
    v.format !== 1 ||
    typeof v.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.version) ||
    typeof v.label !== 'string' ||
    v.label.length > 200 ||
    !Array.isArray(v.sources) ||
    !v.sources.length ||
    v.sources.length > 100 ||
    !Array.isArray(v.records) ||
    !v.records.length ||
    v.records.length > 10000
  )
    return false;
  const files = new Set<string>();
  for (const s of v.sources) {
    if (
      !object(s) ||
      typeof s.file !== 'string' ||
      !s.file ||
      files.has(s.file) ||
      typeof s.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(s.sha256) ||
      !Number.isInteger(s.rows) ||
      Number(s.rows) < 0
    )
      return false;
    files.add(s.file);
  }
  const keys = new Set<string>();
  return v.records.every((r) => {
    if (
      !object(r) ||
      typeof r.key !== 'string' ||
      !r.key ||
      r.key.length > 300 ||
      keys.has(r.key) ||
      !KNOWLEDGE_KINDS.includes(r.kind as never) ||
      typeof r.source !== 'string' ||
      !files.has(r.source) ||
      !Number.isInteger(r.row) ||
      Number(r.row) < 1 ||
      !object(r.data) ||
      Object.values(r.data).some(
        (x) => typeof x !== 'string' || x.length > 100000
      )
    )
      return false;
    keys.add(r.key);
    return true;
  });
}
export function validQuotationKnowledge(v: unknown): v is QuotationKnowledge {
  if (
    !object(v) ||
    Object.keys(v).some(
      (k) =>
        !['prices', 'references', 'manualOverrides', 'costEstimates'].includes(
          k
        )
    ) ||
    !object(v.prices) ||
    Object.keys(v.prices).length > 300 ||
    !Array.isArray(v.references) ||
    v.references.length > 100
  )
    return false;
  if (Object.keys(v.prices).some((k) => !uuid(k))) return false;
  for (const s of [...Object.values(v.prices), ...v.references]) {
    if (
      !object(s) ||
      !uuid(s.recordId) ||
      !uuid(s.batchId) ||
      !Number.isInteger(s.reviewVersion) ||
      Number(s.reviewVersion) < 1 ||
      typeof s.source !== 'string' ||
      s.source.length > 300 ||
      !Number.isInteger(s.sourceRow) ||
      Number(s.sourceRow) < 1 ||
      typeof s.label !== 'string' ||
      s.label.length > 10000 ||
      !validConfiguration(s.configuration) ||
      typeof s.reviewedAt !== 'string' ||
      !Number.isFinite(Date.parse(s.reviewedAt)) ||
      typeof s.capturedAt !== 'string' ||
      !Number.isFinite(Date.parse(s.capturedAt))
    )
      return false;
    if (s.appliedUnitPrice !== undefined && !num(s.appliedUnitPrice))
      return false;
    if (
      s.appliedUnit !== undefined &&
      !['piece', 'm2'].includes(String(s.appliedUnit))
    )
      return false;
    if (s.input !== undefined) {
      const i = s.input;
      if (
        !object(i) ||
        !num(i.width) ||
        !num(i.height) ||
        !num(i.qty, 0.000001) ||
        !['mm', 'cm', 'm'].includes(String(i.measurementUnit)) ||
        typeof i.fifthSheet !== 'boolean' ||
        typeof i.manual !== 'boolean'
      )
        return false;
    }
  }
  if (v.costEstimates !== undefined) {
    if (!object(v.costEstimates) || Object.keys(v.costEstimates).length > 300)
      return false;
    for (const [id, c] of Object.entries(v.costEstimates)) {
      if (
        !uuid(id) ||
        !object(c) ||
        c.ruleVersion !== '55mm-order-rules-v1' ||
        !num(c.width, 0.001) ||
        !num(c.height, 0.001) ||
        !num(c.qty, 1) ||
        !Number.isInteger(c.qty) ||
        !['mm', 'cm', 'm'].includes(String(c.measurementUnit)) ||
        typeof c.automatic !== 'boolean' ||
        !object(c.offers) ||
        !object(c.quantities) ||
        !object(c.extras) ||
        Object.keys(c.offers).length > 50 ||
        Object.keys(c.quantities).length > 50
      )
        return false;
      if (
        Object.values(c.quantities).some((v) => !num(v)) ||
        Object.keys(c.extras).some(
          (k) => !['labour', 'installation', 'delivery', 'other'].includes(k)
        ) ||
        ['labour', 'installation', 'delivery', 'other'].some(
          (k) =>
            c.extras &&
            (c.extras as Record<string, unknown>)[k] !== null &&
            !num((c.extras as Record<string, unknown>)[k])
        )
      )
        return false;
      if (
        !validQuotationKnowledge({
          prices: {},
          references: Object.values(c.offers),
        })
      )
        return false;
    }
  }
  if (v.manualOverrides !== undefined) {
    if (!Array.isArray(v.manualOverrides) || v.manualOverrides.length > 300)
      return false;
    for (const o of v.manualOverrides) {
      if (
        !object(o) ||
        !uuid(o.itemId) ||
        typeof o.reason !== 'string' ||
        !o.reason.trim() ||
        o.reason.length > 2000 ||
        !num(o.unitPrice) ||
        !['piece', 'm2', 'm', 'set', 'pair', 'job'].includes(String(o.unit)) ||
        typeof o.at !== 'string' ||
        !Number.isFinite(Date.parse(o.at)) ||
        !validQuotationKnowledge({ prices: {}, references: [o.previous] })
      )
        return false;
    }
  }
  return true;
}
