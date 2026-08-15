-- ============================================================
-- 061_quotation_pdfs_storage.sql
--
-- Creates the `quotation-pdfs` bucket. Public, matching `chat_media`
-- (023) exactly and for the same reason: WhatsApp's delivery servers
-- fetch the file URL without authentication when sendMediaMessage
-- attaches it. Protection is the same as chat_media already relies
-- on -- account-scoped write RLS plus unguessable random paths
-- (quotation_id, a uuid, not a sequential id).
--
-- See docs/superpowers/specs/2026-08-14-quotations-design.md,
-- Architecture -> PDF generation.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('quotation-pdfs', 'quotation-pdfs', TRUE, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Quotation PDFs are publicly readable" ON storage.objects;
CREATE POLICY "Quotation PDFs are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'quotation-pdfs');

-- Path convention: quotation-pdfs/{quotation_id}/rev-{revision}.pdf
-- Write access requires account membership at agent level or above,
-- checked via the quotation the path's first segment names.
DROP POLICY IF EXISTS "Account members can write quotation PDFs" ON storage.objects;
CREATE POLICY "Account members can write quotation PDFs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'quotation-pdfs'
    AND EXISTS (
      SELECT 1 FROM quotations q
      WHERE q.id::text = (storage.foldername(name))[1]
        AND is_account_member(q.account_id, 'agent')
    )
  );
