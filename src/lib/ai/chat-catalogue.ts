import { approvedCatalogRows } from './catalog';

interface ChatCatalogueRow {
  id: string;
  parent_id?: string | null;
  kind?: string;
  inventory_type?: string;
  status?: string;
  superseded_by?: string | null;
  customer_visible?: boolean;
}
/** Keep category navigation, but exclude internal shelves and withdrawn branches. */
export function chatCatalogueRows<T extends ChatCatalogueRow>(rows: T[]): T[] {
  return approvedCatalogRows(rows).filter(
    (row) => (row.inventory_type ?? 'product') === 'product'
  );
}
