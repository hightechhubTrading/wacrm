ALTER TABLE public.quotations
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid,
  ADD COLUMN conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN client_phone_normalized text GENERATED ALWAYS AS
    (regexp_replace(coalesce(client_phone, ''), '[^0-9]', '', 'g')) STORED;

CREATE INDEX quotations_account_phone_idx
  ON public.quotations (account_id, client_phone_normalized)
  WHERE archived_at IS NULL;

CREATE POLICY quotations_active_select ON public.quotations
  AS RESTRICTIVE FOR SELECT TO authenticated USING (archived_at IS NULL);
CREATE POLICY quotations_active_update ON public.quotations
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (archived_at IS NULL) WITH CHECK (archived_at IS NULL);
CREATE POLICY quotations_active_insert ON public.quotations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (archived_at IS NULL AND archived_by IS NULL AND conversation_id IS NULL);
DROP POLICY quotations_delete ON public.quotations;
CREATE POLICY quotations_keep_records ON public.quotations
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE OR REPLACE FUNCTION public.update_quotations_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Foreign-key actions may still clear references to deleted records.
  IF OLD.archived_at IS NOT NULL AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'Quotation has been removed' USING ERRCODE = 'P0002';
  END IF;
  IF current_user = 'authenticated' AND pg_trigger_depth() = 1 AND
     (NEW.archived_by IS DISTINCT FROM OLD.archived_by OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id) THEN
    RAISE EXCEPTION 'Use the quotation removal action' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at = clock_timestamp();
  IF (to_jsonb(NEW) - ARRAY['updated_at','workspace_version','pdf_storage_path','status','revision','client_phone_normalized'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','workspace_version','pdf_storage_path','status','revision','client_phone_normalized']) THEN
    NEW.workspace_version = OLD.workspace_version + 1;
    NEW.pdf_storage_path = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.archive_quotation(p_account_id uuid, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  quote public.quotations;
BEGIN
  IF NOT public.is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO quote FROM public.quotations
    WHERE id = p_id AND account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found' USING ERRCODE = 'P0002';
  END IF;
  IF quote.archived_at IS NOT NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.quotation_documents
             WHERE quotation_id = p_id AND send_state = 'sending') THEN
    RAISE EXCEPTION 'Quotation send is in progress' USING ERRCODE = '40001';
  END IF;
  UPDATE public.quotations SET archived_at = now(), archived_by = auth.uid()
    WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_quotation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_quotation(uuid, uuid) TO authenticated;
