-- New inbound messages get an ingestion timestamp to resolve Meta's one-second ties.
-- Existing history is not backfilled.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE public.messages ALTER COLUMN received_at SET DEFAULT clock_timestamp();
-- Internal assistance is independent of customer-facing auto-reply; opt-in, no backfill.
ALTER TABLE public.ai_configs ADD COLUMN IF NOT EXISTS sales_assistance_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS ai_rule text CHECK (length(ai_rule) <= 1000);
CREATE TABLE public.ai_sales_assistance (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_message_id text NOT NULL,
  run_token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK(status IN ('processing','ready','failed')),
  analysis jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ai_tag_overrides (
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  blocked boolean NOT NULL,
  PRIMARY KEY(contact_id, tag_id)
);
ALTER TABLE public.ai_sales_assistance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tag_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistance_read ON public.ai_sales_assistance FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND c.account_id=ai_sales_assistance.account_id)
);
REVOKE ALL ON public.ai_sales_assistance, public.ai_tag_overrides FROM anon, authenticated;
GRANT SELECT ON public.ai_sales_assistance TO authenticated;
GRANT ALL ON public.ai_sales_assistance, public.ai_tag_overrides TO service_role;

CREATE FUNCTION public.claim_sales_assistance(p_account uuid,p_conversation uuid,p_source text)
RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE token uuid;
BEGIN
  PERFORM 1 FROM conversations WHERE id=p_conversation AND account_id=p_account FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_configs WHERE account_id=p_account AND is_active AND sales_assistance_enabled) THEN RETURN NULL; END IF;
  IF (SELECT message_id FROM messages WHERE conversation_id=p_conversation AND sender_type='customer' ORDER BY created_at DESC,received_at DESC NULLS LAST,id DESC LIMIT 1) IS DISTINCT FROM p_source THEN RETURN NULL; END IF;
  INSERT INTO ai_sales_assistance(conversation_id,account_id,source_message_id,status)
  VALUES(p_conversation,p_account,p_source,'processing')
  ON CONFLICT(conversation_id) DO UPDATE SET source_message_id=p_source,run_token=gen_random_uuid(),status='processing',updated_at=now()
  WHERE ai_sales_assistance.source_message_id<>p_source OR (ai_sales_assistance.status='processing' AND ai_sales_assistance.updated_at<now()-interval '2 minutes')
  RETURNING run_token INTO token;
  RETURN token;
END $$;

-- Apply all internal effects atomically, after rechecking source, config, rule and order scope.
-- Quiet AI tags deliberately do not run customer-facing tag automations.
CREATE FUNCTION public.apply_sales_assistance(p_account uuid,p_conversation uuid,p_token uuid,p_analysis jsonb,p_deal uuid,p_stage uuid,p_apply boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE c conversations%ROWTYPE; s ai_sales_assistance%ROWTYPE; item jsonb; f custom_fields%ROWTYPE;
  saved_tags jsonb='[]'; saved_fields jsonb='[]'; inserted integer; valid_deal boolean;
BEGIN
  SELECT * INTO c FROM conversations WHERE id=p_conversation AND account_id=p_account FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM ai_sales_assistance WHERE conversation_id=p_conversation AND account_id=p_account AND run_token=p_token FOR UPDATE;
  IF NOT FOUND OR s.status<>'processing' THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_configs WHERE account_id=p_account AND is_active AND sales_assistance_enabled) THEN RETURN NULL; END IF;
  IF (SELECT message_id FROM messages WHERE conversation_id=c.id AND sender_type='customer' ORDER BY created_at DESC,received_at DESC NULLS LAST,id DESC LIMIT 1) IS DISTINCT FROM s.source_message_id THEN RETURN NULL; END IF;
  PERFORM 1 FROM ai_configs WHERE account_id=p_account FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM ai_configs WHERE account_id=p_account AND is_active AND sales_assistance_enabled) THEN RETURN NULL; END IF;
  PERFORM 1 FROM contacts WHERE id=c.contact_id AND account_id=p_account FOR UPDATE;
  PERFORM 1 FROM deals WHERE id=p_deal AND account_id=p_account AND contact_id=c.contact_id FOR UPDATE;
  valid_deal := EXISTS(SELECT 1 FROM deals WHERE id=p_deal AND account_id=p_account AND contact_id=c.contact_id AND status='open' AND stage_id=p_stage AND id=(SELECT id FROM deals WHERE account_id=p_account AND contact_id=c.contact_id AND status='open' ORDER BY created_at DESC,id DESC LIMIT 1));
  IF p_apply THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_analysis->'tags') LOOP
      PERFORM 1 FROM tags WHERE id=(item->>'id')::uuid AND account_id=p_account FOR SHARE;
      IF EXISTS(SELECT 1 FROM tags WHERE id=(item->>'id')::uuid AND account_id=p_account AND nullif(trim(ai_rule),'') IS NOT NULL AND ai_rule=item->>'rule')
        AND NOT EXISTS(SELECT 1 FROM ai_tag_overrides WHERE contact_id=c.contact_id AND tag_id=(item->>'id')::uuid AND blocked) THEN
        INSERT INTO contact_tags(contact_id,tag_id) VALUES(c.contact_id,(item->>'id')::uuid) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS inserted=ROW_COUNT;
        IF inserted>0 THEN saved_tags:=saved_tags||jsonb_build_array(item); END IF;
      END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(p_analysis->'fields') LOOP
      SELECT * INTO f FROM custom_fields WHERE id=(item->>'id')::uuid AND account_id=p_account FOR SHARE;
      IF NOT FOUND THEN CONTINUE; END IF;
      PERFORM 1 FROM stage_required_groups l JOIN custom_field_groups g ON g.id=l.group_id WHERE l.stage_id=p_stage AND g.id=f.group_id FOR SHARE;
      IF (item->>'scope')='contact' AND f.ai_collectible AND f.group_id IS NULL THEN
        INSERT INTO contact_custom_values(contact_id,custom_field_id,value) VALUES(c.contact_id,f.id,item->>'value')
        ON CONFLICT(contact_id,custom_field_id) DO UPDATE SET value=EXCLUDED.value WHERE nullif(trim(contact_custom_values.value),'') IS NULL;
      ELSIF valid_deal AND EXISTS(SELECT 1 FROM stage_required_groups l JOIN custom_field_groups g ON g.id=l.group_id WHERE l.stage_id=p_stage AND g.id=f.group_id AND g.is_active AND g.account_id=p_account AND g.scope='deal') AND (item->>'scope')='deal' THEN
        INSERT INTO deal_custom_values(deal_id,custom_field_id,value) VALUES(p_deal,f.id,item->>'value')
        ON CONFLICT(deal_id,custom_field_id) DO UPDATE SET value=EXCLUDED.value WHERE nullif(trim(deal_custom_values.value),'') IS NULL;
      ELSE CONTINUE; END IF;
      GET DIAGNOSTICS inserted=ROW_COUNT;
      IF inserted>0 THEN saved_fields:=saved_fields||jsonb_build_array(item); END IF;
    END LOOP;
  END IF;
  IF p_analysis->>'action' IN ('reply','ask_details') AND (SELECT sender_type FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC,received_at DESC NULLS LAST,id DESC LIMIT 1) IN ('agent','bot') THEN
    p_analysis:=p_analysis||jsonb_build_object('action','wait');
  END IF;
  p_analysis:=p_analysis||jsonb_build_object('tags',saved_tags,'fields',saved_fields,'preview',NOT p_apply);
  UPDATE ai_sales_assistance SET analysis=p_analysis,status='ready',updated_at=now() WHERE conversation_id=c.id;
  RETURN p_analysis;
END $$;
REVOKE ALL ON FUNCTION public.claim_sales_assistance(uuid,uuid,text), public.apply_sales_assistance(uuid,uuid,uuid,jsonb,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sales_assistance(uuid,uuid,text), public.apply_sales_assistance(uuid,uuid,uuid,jsonb,uuid,uuid,boolean) TO service_role;

-- Human removal and future suppression are one transaction, serialized with assistance.
CREATE FUNCTION public.set_sales_tag_override(p_contact uuid,p_tag uuid,p_blocked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a uuid;
BEGIN
  SELECT account_id INTO a FROM contacts WHERE id=p_contact FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_id=a AND account_role IN ('owner','admin','agent'))
    OR NOT EXISTS(SELECT 1 FROM tags WHERE id=p_tag AND account_id=a) THEN RAISE EXCEPTION 'Tag access denied'; END IF;
  INSERT INTO ai_tag_overrides(contact_id,tag_id,account_id,blocked) VALUES(p_contact,p_tag,a,p_blocked)
  ON CONFLICT(contact_id,tag_id) DO UPDATE SET blocked=p_blocked;
  IF p_blocked THEN DELETE FROM contact_tags WHERE contact_id=p_contact AND tag_id=p_tag; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_sales_tag_override(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_sales_tag_override(uuid,uuid,boolean) TO authenticated;
-- Usage remains in the existing provider ledger, separately identified.
ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log ADD CONSTRAINT ai_usage_log_mode_check CHECK(mode IN ('auto_reply','draft','translate','assistance'));

-- Existing auto-reply product tags honor the same human suppression under a contact lock.
CREATE FUNCTION public.add_sales_ai_tag(p_account uuid,p_contact uuid,p_tag uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE inserted integer;
BEGIN
  PERFORM 1 FROM contacts WHERE id=p_contact AND account_id=p_account FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM tags WHERE id=p_tag AND account_id=p_account) THEN RAISE EXCEPTION 'Invalid tag account'; END IF;
  IF EXISTS(SELECT 1 FROM ai_tag_overrides WHERE contact_id=p_contact AND tag_id=p_tag AND blocked) THEN RETURN false; END IF;
  INSERT INTO contact_tags(contact_id,tag_id) VALUES(p_contact,p_tag) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT; RETURN inserted>0;
END $$;
REVOKE ALL ON FUNCTION public.add_sales_ai_tag(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_sales_ai_tag(uuid,uuid,uuid) TO service_role;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables) AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ai_sales_assistance') THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_sales_assistance;
 END IF;
END $$;

ALTER TABLE public.ai_judgment_log DROP CONSTRAINT IF EXISTS ai_judgment_log_workflow_check;
ALTER TABLE public.ai_judgment_log ADD CONSTRAINT ai_judgment_log_workflow_check CHECK(workflow IN ('auto_reply','draft','playground','assistance'));
