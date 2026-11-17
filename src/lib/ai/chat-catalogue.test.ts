import { describe, expect, it } from 'vitest';
import { chatCatalogueRows } from './chat-catalogue';

describe('chat product shelves', () => {
  it('includes approved product categories and products while excluding other shelves', () => {
    const rows = [
      { id: 'windows', kind: 'family', inventory_type: 'product' },
      {
        id: '41',
        parent_id: 'windows',
        kind: 'product',
        inventory_type: 'product',
      },
      ...['component', 'equipment', 'service'].map((inventory_type) => ({
        id: inventory_type,
        inventory_type,
      })),
    ];
    expect(chatCatalogueRows(rows).map((r) => r.id)).toEqual(['windows', '41']);
  });
  it('rejects hidden, draft, replaced and orphaned branches', () => {
    const rows = [
      { id: 'draft', status: 'draft' },
      { id: 'child', parent_id: 'draft' },
      { id: 'hidden', customer_visible: false },
      { id: 'hidden-child', parent_id: 'hidden' },
      { id: 'old', superseded_by: 'new' },
      { id: 'orphan', parent_id: 'missing' },
      { id: 'new', status: 'approved' },
    ];
    expect(chatCatalogueRows(rows).map((r) => r.id)).toEqual(['new']);
  });
});
