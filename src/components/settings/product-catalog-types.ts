import { createClient } from '@/lib/supabase/client';

export interface ProductFile {
  id: string;
  label: string | null;
  ai_description: string | null;
  media_kind: 'image' | 'document';
  mime_type: string;
  storage_path: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  tag_label: string | null;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  price_notes: string | null;
  updated_at: string;
  files: ProductFile[];
}

/** Public URL for a file in the `ai-media` bucket (already public --
 * this is a pure client-side string construction, no network call). */
export function productMediaPublicUrl(storagePath: string): string {
  return createClient().storage.from('ai-media').getPublicUrl(storagePath).data.publicUrl;
}
