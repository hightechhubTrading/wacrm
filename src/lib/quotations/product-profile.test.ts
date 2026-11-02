import { describe, it, expect } from 'vitest';
import {
  productProfile,
  productItemReference,
  sellableCatalogue,
  catalogueChoices,
  quotationDelivery,
} from './product-profile';
import { cataloguePriceRows, type CatalogueProduct } from './catalogue';
const product = {
  id: 'p',
  name: 'Motorized Window Shutters',
  kind: 'variant',
  parent_id: 'parent',
  sku: 'WS-MOTOR',
  inventory_type: 'product',
  unit_of_measure: 'm2',
  price_unit: 'per_square_meter',
  specifications: 'Standard colours: white and beige.',
  description: 'External aluminium shutters.',
  aliases: [],
  sources: [],
} as unknown as CatalogueProduct;
describe('product-led quotation profiles', () => {
  it('uses the selected product family and preserves separate supplier SKUs', () => {
    expect(
      productItemReference(product, [
        { id: 'i', itemCode: 'WS01', itemType: 'line' },
      ])
    ).toBe('WS02');
    expect(
      productProfile({
        ...product,
        inventory_type: 'equipment',
        sku: 'HT-EQP-014',
        productCode: 'WS',
      }).code
    ).toBe('MOT');
    expect(productProfile(product).fields.map((f) => f.key)).toEqual([
      'finish',
      'profile',
    ]);
    expect(
      productProfile({ ...product, sku: 'PIV-01' }).fields.map((f) => f.key)
    ).toEqual(['finish', 'design', 'handle']);
  });
  it('keeps parents out of sale choices and groups supplier configurations under their model', () => {
    const parent = {
      ...product,
      id: 'parent',
      kind: 'family',
      parent_id: null,
    };
    expect(sellableCatalogue([parent, product])).toEqual([product]);
    const screens = [
      'Soltis · Somfy',
      'Soltis · Mosel',
      'Flyscreen · Somfy',
    ].map((v, i) => ({
      ...product,
      id: 'screen' + i,
      name: 'Electroll 103 · ' + v,
    }));
    const choices = catalogueChoices(screens);
    expect(choices).toHaveLength(1);
    expect(choices[0].title).toBe('Electroll 103');
    expect(choices[0].products).toHaveLength(3);
  });
  it('never offers motors and accessories as the shutter area rate', () => {
    const source = {
      id: 'rate',
      kind: 'price',
      data: {
        unit: 'per m2',
        item_en: 'Window shutter RC 41 / 55 (installed)',
      },
      configuration: {},
    };
    const motor = {
      ...source,
      id: 'motor',
      data: { unit: 'per motor', item_en: 'Tubular motor' },
    };
    expect(
      cataloguePriceRows({ ...product, sources: [source, motor] as never })
    ).toEqual([source]);
  });
  it('summarizes selected item delivery exceptions once at quotation level', () => {
    const items = [
      { id: 'a', itemType: 'line' as const, itemCode: 'WS01' },
      { id: 'b', itemType: 'line' as const, itemCode: 'SEC01' },
    ];
    expect(
      quotationDelivery(items, {
        a: { selections: { deliveryPeriod: '25–35 days' } },
        b: { selections: { deliveryPeriod: '10–15 days' } },
      })
    ).toBe('WS01: 25–35 days\nSEC01: 10–15 days');
  });
});
