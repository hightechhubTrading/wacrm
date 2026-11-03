import { expect, it } from 'vitest';
import { productContext } from './product-context';
import type { ProductPromptItem } from './media-library';
const products = [
  {
    id: 'a',
    name: 'UPVC windows',
    description: '',
    files: [],
    priceUnit: null,
    priceNotes: null,
    tagId: null,
    priceMin: null,
    priceMax: null,
  },
  {
    id: 'b',
    name: 'Garage doors',
    description: '',
    files: [],
    priceUnit: null,
    priceNotes: null,
    tagId: null,
    priceMin: 100,
    priceMax: 200,
  },
] as ProductPromptItem[];
it('retains discovered exact matches and does not borrow sibling prices', () => {
  const result = productContext(
    products,
    [],
    [{ role: 'user', content: 'UPVC windows please' }]
  );
  expect(result.map((p) => p.id)).toEqual(['a']);
  expect(result[0].priceMin).toBeNull();
});
it('retains discovery coverage when retrieval and explicit names do not identify a candidate', () => {
  expect(
    productContext(
      products,
      [],
      [{ role: 'user', content: 'What do you have?' }]
    )
  ).toEqual(products);
});
it.each(['مرحبا', 'مرحباً!', 'السلام عليكم', 'Hello!'])(
  'loads no product facts for an isolated greeting: %s',
  (content) => {
    const large = Array.from({ length: 123 }, (_, i) => ({
      ...products[0],
      id: `p-${i}`,
      name: `Product ${i}`,
      description: 'Long specifications. '.repeat(70),
    }));
    expect(
      productContext(
        large,
        [
          '[source product=00000000-0000-4000-8000-000000000001] irrelevant retrieval',
        ],
        [{ role: 'user', content }]
      )
    ).toEqual([]);
  }
);
it('bounds discovery for a company-sized inventory while retaining original complete records', () => {
  const large = Array.from({ length: 123 }, (_, i) => ({
    ...products[0],
    id: `p-${i}`,
    name: `Product ${i}`,
    description: 'Long specifications. '.repeat(70),
  }));
  const result = productContext(
    large,
    [],
    [{ role: 'user', content: 'What do you have?' }]
  );
  expect(result).toHaveLength(8);
  expect(result[0]).toBe(large[0]);
});
it('selects an exact late-inventory match ahead of generic word matches and preserves its conditions', () => {
  const large = Array.from({ length: 123 }, (_, i) => ({
    ...products[0],
    id: `p-${i}`,
    name: `Window model ${i}`,
    description: 'Complete limits and specifications.',
  }));
  const result = productContext(
    large,
    [],
    [{ role: 'user', content: 'Window model 122 please' }]
  );
  expect(result.length).toBeLessThanOrEqual(8);
  expect(result[0]).toBe(large[122]);
});
it('uses category discovery before unrelated detailed variants', () => {
  const category = {
    ...products[0],
    id: 'category',
    name: 'Windows and doors',
    catalog: { kind: 'family' },
  } as ProductPromptItem;
  expect(
    productContext(
      [...products, category],
      [],
      [{ role: 'user', content: 'What do you offer?' }]
    )
  ).toEqual([category]);
});
it('does not treat a greeting with a product request or prior conversation as an isolated greeting', () => {
  expect(
    productContext(
      products,
      [],
      [{ role: 'user', content: 'مرحبا UPVC windows please' }]
    ).map((p) => p.id)
  ).toEqual(['a']);
  expect(
    productContext(
      products,
      [],
      [
        { role: 'user', content: 'UPVC windows please' },
        { role: 'assistant', content: 'What size?' },
        { role: 'user', content: 'مرحبا' },
      ]
    ).map((p) => p.id)
  ).toEqual(['a']);
});
