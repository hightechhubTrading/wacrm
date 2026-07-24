-- ============================================================
-- 038_ai_media_library.sql -- AI media library (product images / catalogs)
--
-- Gives the AI assistant (migration 029) an account-owned media
-- library so the autonomous auto-reply bot (034/auto-reply.ts) can
-- naturally decide, mid-conversation, to attach a product photo or
-- catalog file -- no scripted Flow/keyword trigger involved.
--
-- Mirrors ai_knowledge_documents (030) for the table + RLS shape, and
-- chat_media (023) / flow_media (016) for the storage bucket + RLS
-- shape (account-scoped writes, public reads so Meta can fetch the
-- file at send time).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. ai_media_library table
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_media_library (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    name text NOT NULL,
    product_label text,
    description text NOT NULL,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    media_kind text NOT NULL CHECK (media_kind IN ('image', 'document')),
    file_size bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

CREATE INDEX IF NOT EXISTS ai_media_library_account_id_idx
  ON ai_media_library (account_id);

ALTER TABLE ai_media_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_media_library_select ON ai_media_library;
CREATE POLICY ai_media_library_select ON ai_media_library FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_media_library_insert ON ai_media_library;
CREATE POLICY ai_media_library_insert ON ai_media_library FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_media_library_update ON ai_media_library;
CREATE POLICY ai_media_library_update ON ai_media_library FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_media_library_delete ON ai_media_library;
CREATE POLICY ai_media_library_delete ON ai_media_library FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_media_library_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_media_library_updated_at ON ai_media_library;
CREATE TRIGGER ai_media_library_updated_at
  BEFORE UPDATE ON ai_media_library
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_media_library_updated_at();

-- ============================================================
-- 2. ai-media storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'ai-media',
    'ai-media',
    TRUE,
    16777216, -- 16 MB, matches chat-media / flow-media
  ARRAY[
      'image/png', 'image/jpeg', 'image/webp',
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  )
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 3. Storage RLS -- account-scoped writes, public reads
-- ============================================================
DROP POLICY IF EXISTS "AI media is publicly readable" ON storage.objects;
CREATE POLICY "AI media is publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'ai-media');

DROP POLICY IF EXISTS "Admins can upload ai media" ON storage.objects;
CREATE POLICY "Admins can upload ai media"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'ai-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can update ai media" ON storage.objects;
CREATE POLICY "Admins can update ai media"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'ai-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can delete ai media" ON storage.objects;
CREATE POLICY "Admins can delete ai media"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'ai-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
