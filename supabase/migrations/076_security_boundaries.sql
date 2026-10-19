-- Security audit remediation. Apply before deploying routes that call the new
-- record_conversation_conversion RPC. No production migration is performed by Git.
BEGIN;

-- Server-internal helpers must not inherit default PUBLIC EXECUTE.
REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid,integer) TO service_role;

-- Serialize caller and target authorization in stable UUID order. In particular,
-- a removal cannot move a target between an authorization read and its write.
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id FOR UPDATE;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Can't change own role via this endpoint.
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve target.
  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  -- Target must be in caller's account.
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Owner role changes go through transfer_account_ownership.
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID  -- the new personal account id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Spin up a fresh personal account for the removed user. Mirror
  -- of handle_new_user's logic — keep them whole, just relocated.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.profiles
  WHERE user_id IN (auth.uid(), p_new_owner_user_id)
  ORDER BY user_id FOR UPDATE;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Demote current owner first so the temporary state where the
  -- account has zero owners is never visible — both writes happen
  -- in the same function transaction.
  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_phone(
  p_user_id UUID,
  p_phone TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.profiles
  WHERE user_id IN (auth.uid(), p_user_id)
  ORDER BY user_id FOR UPDATE;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Target must be in the caller's account.
  SELECT account_id INTO v_target_account_id
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id IS DISTINCT FROM v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET phone = NULLIF(TRIM(p_phone), '')
  WHERE user_id = p_user_id;
END;
$$;

-- Guard relationships BEFORE definer AFTER triggers can dereference them.
-- Existing corrupt rows are not silently rewritten. The checks fail closed on
-- their next relationship/status write; see docs/security-remediation.md.
CREATE OR REPLACE FUNCTION public.enforce_crm_relationship_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_conversation public.conversations;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'CRM records cannot be moved between accounts' USING ERRCODE='23514';
  END IF;
  IF NEW.contact_id IS NOT NULL THEN
    -- Parent account IDs are immutable; existing foreign keys protect lifetime.
    -- Avoid child-to-parent locks that invert the conversion RPC's lock order.
    PERFORM 1 FROM contacts WHERE id=NEW.contact_id AND account_id=NEW.account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contact does not belong to record account' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'deals' THEN
    IF NEW.conversation_id IS NOT NULL THEN
      SELECT * INTO v_conversation FROM conversations
      WHERE id=NEW.conversation_id AND account_id=NEW.account_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Conversation does not belong to deal account' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_crm_relationship_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_conversation_relationship_scope BEFORE INSERT OR UPDATE OF account_id, contact_id ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_relationship_scope();
CREATE TRIGGER enforce_deal_relationship_scope BEFORE INSERT OR UPDATE OF account_id, contact_id, conversation_id, status ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.enforce_crm_relationship_scope();

-- Contacts are tenant roots. Forbid moving the parent out from under references.
CREATE OR REPLACE FUNCTION public.prevent_contact_account_move()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'Contacts cannot be moved between accounts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_contact_account_move() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER prevent_contact_account_move BEFORE UPDATE OF account_id ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.prevent_contact_account_move();

-- Both relationship and assignment authorization belong to the final write.
CREATE OR REPLACE FUNCTION public.mark_conversation_deal_won(p_conversation_id uuid, p_value numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_profile public.profiles; v_conv public.conversations; v_deal public.deals;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF p_value IS NULL OR p_value <= 0 OR p_value::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Invalid value' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_profile FROM profiles WHERE user_id=auth.uid() FOR SHARE;
  IF v_profile.account_role NOT IN ('owner','admin','agent') OR v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_conv FROM conversations WHERE id=p_conversation_id AND account_id=v_profile.account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='P0002'; END IF;
  IF v_profile.account_role='agent' AND v_conv.assigned_agent_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Conversation not assigned to caller' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_deal FROM deals WHERE conversation_id=v_conv.id AND account_id=v_profile.account_id
    ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No linked deal' USING ERRCODE='P0002'; END IF;
  IF v_profile.account_role='agent' AND v_deal.assigned_to IS NOT NULL AND v_deal.assigned_to IS DISTINCT FROM v_profile.id THEN
    RAISE EXCEPTION 'Deal not assigned to caller' USING ERRCODE='42501';
  END IF;
  UPDATE deals SET value=p_value,currency='QAR',status='won' WHERE id=v_deal.id AND account_id=v_profile.account_id;
  RETURN v_deal.id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_conversation_deal_won(uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_deal_won(uuid,numeric) TO authenticated;

-- Notification addressing is not proof of current account membership.
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
USING (auth.uid()=user_id AND public.is_account_member(account_id));
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
USING (auth.uid()=user_id AND public.is_account_member(account_id))
WITH CHECK (auth.uid()=user_id AND public.is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.enforce_notification_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM 1 FROM profiles WHERE user_id=NEW.user_id AND account_id=NEW.account_id
    AND account_role IN ('owner','admin','agent');
  -- Best-effort producers must not cause a business operation to fail for a
  -- removed recipient. Silently discard the notice, never the business write.
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND account_id=NEW.account_id
  ) THEN RETURN NULL; END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts WHERE id=NEW.contact_id AND account_id=NEW.account_id
  ) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_notification_recipient() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_notification_recipient BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_recipient();

CREATE OR REPLACE FUNCTION public.clear_departed_member_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.account_id IS DISTINCT FROM NEW.account_id THEN
    UPDATE ai_configs SET handoff_agent_id=NULL WHERE account_id=OLD.account_id AND handoff_agent_id=NEW.user_id;
    UPDATE conversations SET assigned_agent_id=NULL WHERE account_id=OLD.account_id AND assigned_agent_id=NEW.user_id;
    UPDATE deals SET assigned_to=NULL WHERE account_id=OLD.account_id AND assigned_to=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_departed_member_references() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clear_departed_member_references AFTER UPDATE OF account_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.clear_departed_member_references();

-- Runtime JSON validation covers direct table writes and authenticated RPCs.
CREATE OR REPLACE FUNCTION public.validate_quotation_document_details()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE k text; v jsonb; v_share jsonb;
BEGIN
  IF jsonb_typeof(NEW.document_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid document details' USING ERRCODE='22023';
  END IF;
  FOR k,v IN SELECT * FROM jsonb_each(NEW.document_details) LOOP
    IF k IN ('consultant','subjectAr','included','excluded','notes','preparedBy','repPhone','commercialPreset') THEN
      IF jsonb_typeof(v)<>'string' OR length(v #>> '{}')>10000 THEN
        RAISE EXCEPTION 'Invalid document text' USING ERRCODE='22023';
      END IF;
    ELSIF k='shopDrawingDays' THEN
      IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'Invalid shop drawing days' USING ERRCODE='22023'; END IF;
      IF (v #>> '{}')::numeric < 0 OR trunc((v #>> '{}')::numeric) <> (v #>> '{}')::numeric THEN
        RAISE EXCEPTION 'Invalid shop drawing days' USING ERRCODE='22023';
      END IF;
    ELSIF k='paymentSchedule' THEN
      IF jsonb_typeof(v)<>'object' THEN RAISE EXCEPTION 'Invalid payment schedule' USING ERRCODE='22023'; END IF;
      FOREACH k IN ARRAY ARRAY['advance','delivery','completion'] LOOP
        v_share:=v->k;
        IF jsonb_typeof(v_share) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid payment share' USING ERRCODE='22023'; END IF;
        IF (v_share #>> '{}')::numeric < 0 OR (v_share #>> '{}')::numeric > 100 THEN
          RAISE EXCEPTION 'Invalid payment share' USING ERRCODE='22023';
        END IF;
      END LOOP;
      IF v ? 'deliveryTrigger' AND (jsonb_typeof(v->'deliveryTrigger') IS DISTINCT FROM 'string' OR v->>'deliveryTrigger' NOT IN ('before_installation','on_delivery')) THEN
        RAISE EXCEPTION 'Invalid delivery trigger' USING ERRCODE='22023';
      END IF;
    ELSE RAISE EXCEPTION 'Unknown document detail' USING ERRCODE='22023';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_quotation_document_details() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_quotation_document_details BEFORE INSERT OR UPDATE OF document_details ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.validate_quotation_document_details();

-- Folder ownership is necessary, but never substitutes for a write role.
DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='chat-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
;
DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='chat-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
WITH CHECK (bucket_id='chat-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
;
DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='chat-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
;
DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='flow-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND (('account-' || p.account_id::text) = (storage.foldername(name))[1] OR p.user_id::text = (storage.foldername(name))[1])))
;
DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Members can update flow media" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='flow-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND (('account-' || p.account_id::text) = (storage.foldername(name))[1] OR p.user_id::text = (storage.foldername(name))[1])))
WITH CHECK (bucket_id='flow-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND (('account-' || p.account_id::text) = (storage.foldername(name))[1] OR p.user_id::text = (storage.foldername(name))[1])))
;
DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Members can delete flow media" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='flow-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent') AND (('account-' || p.account_id::text) = (storage.foldername(name))[1] OR p.user_id::text = (storage.foldername(name))[1])))
;
DROP POLICY IF EXISTS "Admins can upload ai media" ON storage.objects;
CREATE POLICY "Admins can upload ai media" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='ai-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
;
DROP POLICY IF EXISTS "Admins can update ai media" ON storage.objects;
CREATE POLICY "Admins can update ai media" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='ai-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
WITH CHECK (bucket_id='ai-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
;
DROP POLICY IF EXISTS "Admins can delete ai media" ON storage.objects;
CREATE POLICY "Admins can delete ai media" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='ai-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin') AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]))
;

-- Public object delivery does not require a bucket-wide metadata/list policy.
-- Keep public links for Meta, but disclose paths only through visible quotations.
DROP POLICY IF EXISTS "Quotation PDFs are publicly readable" ON storage.objects;
CREATE POLICY "Visible quotations can list their PDFs" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='quotation-pdfs' AND EXISTS (
  SELECT 1 FROM public.quotations q
  WHERE q.id::text=(storage.foldername(name))[1]
    AND public.is_account_member(q.account_id,'agent')
));

-- Defense in depth for existing rows as well as new relationships.
CREATE OR REPLACE FUNCTION public.create_lead_deal_for_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
  v_stage_id UUID;
  v_title TEXT;
  v_currency TEXT;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE account_id = NEW.account_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_stage_id
  FROM pipeline_stages
  WHERE pipeline_id = v_pipeline_id
  ORDER BY position ASC
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), NULLIF(phone, ''), 'New lead') INTO v_title
  FROM contacts
  WHERE id = NEW.contact_id AND account_id = NEW.account_id;

  SELECT default_currency INTO v_currency
  FROM accounts
  WHERE id = NEW.account_id;

  INSERT INTO deals (
    account_id, user_id, pipeline_id, stage_id, contact_id, conversation_id, title, currency
  ) VALUES (
    NEW.account_id, NEW.user_id, v_pipeline_id, v_stage_id, NEW.contact_id, NEW.id,
    COALESCE(v_title, 'New lead'), COALESCE(v_currency, 'USD')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to auto-create lead deal for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Defense in depth for existing rows as well as new relationships.
CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id AND account_id = NEW.account_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Defense in depth for existing rows as well as new relationships.
CREATE OR REPLACE FUNCTION public.enqueue_won_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM 'won' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  v_conversation_id := NEW.conversation_id;
  IF v_conversation_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT id INTO v_conversation_id
    FROM conversations
    WHERE contact_id = NEW.contact_id AND account_id = NEW.account_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  IF v_conversation_id IS NULL OR NOT EXISTS (SELECT 1 FROM conversations WHERE id=v_conversation_id AND account_id=NEW.account_id) THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_conversion(
    v_conversation_id, 'won', NEW.value, NEW.currency, NEW.id, auth.uid()
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to enqueue Won conversion for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Authorize and enqueue every conversion stage in one transaction. The won
-- helper reuses these locks and validates the linked deal's assignment.
CREATE OR REPLACE FUNCTION public.record_conversation_conversion(
  p_conversation_id uuid, p_stage text, p_value numeric DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_profile public.profiles; v_conv public.conversations; v_deal_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('qualified','site_visit','won') THEN
    RAISE EXCEPTION 'Invalid stage' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_profile FROM profiles WHERE user_id=auth.uid() FOR SHARE;
  IF v_profile.id IS NULL OR v_profile.account_role NOT IN ('owner','admin','agent') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_conv FROM conversations WHERE id=p_conversation_id AND account_id=v_profile.account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='P0002'; END IF;
  IF v_profile.account_role='agent' AND v_conv.assigned_agent_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Conversation not assigned to caller' USING ERRCODE='42501';
  END IF;
  IF p_stage='won' THEN
    v_deal_id:=public.mark_conversation_deal_won(p_conversation_id,p_value);
  END IF;
  PERFORM public.enqueue_conversion(p_conversation_id,p_stage,
    CASE WHEN p_stage='won' THEN p_value END,
    CASE WHEN p_stage='won' THEN 'QAR'::text END,v_deal_id,auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.record_conversation_conversion(uuid,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_conversation_conversion(uuid,text,numeric) TO authenticated;

COMMIT;
