import { supabaseAdmin } from './admin-client';
import { REFERENCE_IMAGE_BUCKET } from './reference-image-server';

export async function cleanupQuotationImages() {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc('claim_unused_quotation_images');
  if (error) throw new Error('Quotation image cleanup unavailable');
  for (const image of data ?? []) {
    const { error: removed } = await db.storage
      .from(REFERENCE_IMAGE_BUCKET)
      .remove([image.storage_path]);
    if (!removed) {
      const { error: deleted } = await db
        .from('quotation_images')
        .delete()
        .eq('storage_path', image.storage_path)
        .eq('deleting', true);
      if (deleted)
        throw new Error('Quotation image cleanup registry unavailable');
    }
  }
}

const KEY = Symbol.for('wacrm.quotation-image-cleanup');
/** Same long-lived-container maintenance pattern as the existing conversion poller. */
export function startQuotationImageCleanup(intervalMs = 3_600_000) {
  const g = globalThis as typeof globalThis & {
    [KEY]?: ReturnType<typeof setInterval>;
  };
  if (g[KEY]) return;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await cleanupQuotationImages();
    } catch {
      console.warn('[quotation images] cleanup unavailable');
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref?.();
  g[KEY] = timer;
}
