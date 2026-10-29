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
