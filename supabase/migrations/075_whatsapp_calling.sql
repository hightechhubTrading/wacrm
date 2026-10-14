-- Apply before deploying calling UI. CRM calling is opt-in per account.
ALTER TABLE public.whatsapp_config ADD COLUMN IF NOT EXISTS calling_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.whatsapp_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  meta_call_id text,
  phone_number_id text NOT NULL,
  customer_phone text,
  customer_name text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  state text NOT NULL CHECK (state IN ('ringing','connecting','active','completed','missed','rejected','failed')),
  agent_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_client_id text,
  remote_sdp text,
  remote_sdp_type text CHECK (remote_sdp_type IN ('offer','answer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer CHECK (duration_seconds >= 0),
  error_message text,
  UNIQUE(account_id, meta_call_id)
);
CREATE INDEX whatsapp_calls_history ON public.whatsapp_calls(account_id, conversation_id, created_at DESC);
-- A browser owns at most one live call, including concurrent HTTP requests.
CREATE UNIQUE INDEX whatsapp_calls_agent_live ON public.whatsapp_calls(agent_user_id)
  WHERE state IN ('connecting','active') AND agent_user_id IS NOT NULL;
ALTER TABLE public.whatsapp_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_calls_read ON public.whatsapp_calls FOR SELECT TO authenticated USING (
  public.is_account_member(account_id, 'agent') AND (
    public.is_account_member(account_id, 'admin') OR EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.account_id = whatsapp_calls.account_id
    )
  )
);
-- Call state, SDP and ownership are changed only by authenticated server routes
-- or signed Meta webhooks; clients cannot claim by updating the table directly.
GRANT SELECT ON public.whatsapp_calls TO authenticated;
GRANT ALL ON public.whatsapp_calls TO service_role;

-- Audit statuses can arrive before the connect webhook/HTTP response. Buffer
-- them privately so ACCEPTED/REJECTED are not lost in that race.
CREATE TABLE public.whatsapp_call_status_events (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  meta_call_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('connecting','active','rejected')),
  event_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, meta_call_id)
);
ALTER TABLE public.whatsapp_call_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_call_status_events FROM anon, authenticated;
GRANT ALL ON public.whatsapp_call_status_events TO service_role;

-- Serialize duplicate/out-of-order deliveries and the outbound response/webhook
-- race. A late connect/ringing event must never resurrect an ended call.
CREATE FUNCTION public.ingest_whatsapp_call(p_account_id uuid, p_event jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.whatsapp_calls%ROWTYPE;
  v_state text;
  v_meta text := p_event->>'meta_call_id';
  v_local uuid;
  v_status public.whatsapp_call_status_events%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':' || v_meta, 0));
  IF p_event->>'event' = 'status' THEN
    INSERT INTO public.whatsapp_call_status_events VALUES (
      p_account_id, v_meta, p_event->>'state', COALESCE((p_event->>'created_at')::timestamptz, now())
    ) ON CONFLICT (account_id, meta_call_id) DO UPDATE SET
      state = EXCLUDED.state, event_at = EXCLUDED.event_at
      WHERE whatsapp_call_status_events.state <> 'rejected'
        AND (EXCLUDED.state = 'rejected' OR (
          EXCLUDED.event_at >= whatsapp_call_status_events.event_at
          AND NOT (whatsapp_call_status_events.state = 'active' AND EXCLUDED.state = 'connecting')
        ));
  END IF;
  SELECT * INTO v FROM public.whatsapp_calls WHERE account_id = p_account_id AND meta_call_id = v_meta FOR UPDATE;
  IF v.id IS NULL AND (p_event->>'local_id') ~ '^[0-9a-fA-F-]{36}$' THEN
    v_local := (p_event->>'local_id')::uuid;
    SELECT * INTO v FROM public.whatsapp_calls WHERE id = v_local AND account_id = p_account_id
      AND direction = 'outbound' AND (meta_call_id IS NULL OR meta_call_id = v_meta) FOR UPDATE;
  END IF;
  v_state := p_event->>'state';
  IF p_event->>'event' = 'status' AND v.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_status FROM public.whatsapp_call_status_events WHERE account_id = p_account_id AND meta_call_id = v_meta;
  IF v_status.state = 'active' AND v_state IN ('ringing','connecting') THEN v_state := 'active'; END IF;
  IF v_status.state = 'rejected' AND p_event->>'event' <> 'terminate' THEN v_state := 'rejected'; END IF;
  IF v.id IS NULL THEN
    INSERT INTO public.whatsapp_calls(account_id, meta_call_id, phone_number_id, conversation_id,
      customer_phone, customer_name, direction, state, created_at)
    VALUES (p_account_id, v_meta, p_event->>'phone_number_id', (p_event->>'conversation_id')::uuid,
      p_event->>'customer_phone', p_event->>'customer_name', p_event->>'direction', v_state,
      COALESCE((p_event->>'created_at')::timestamptz, now())) RETURNING * INTO v;
  END IF;
  UPDATE public.whatsapp_calls SET
    meta_call_id = v_meta,
    remote_sdp = COALESCE(p_event->>'remote_sdp', remote_sdp),
    remote_sdp_type = COALESCE(p_event->>'remote_sdp_type', remote_sdp_type),
    state = CASE
      WHEN p_event->>'event' = 'terminate' THEN
        CASE WHEN v.state = 'rejected' THEN 'rejected'
          WHEN v_state = 'failed' THEN 'failed'
          WHEN p_event->>'answered_at' IS NOT NULL OR v.answered_at IS NOT NULL THEN 'completed'
          WHEN v.direction = 'inbound' THEN 'missed' ELSE 'completed' END
      WHEN v.ended_at IS NOT NULL OR v.state IN ('completed','missed','rejected','failed') THEN v.state
      WHEN v_state = 'rejected' THEN 'rejected'
      WHEN v.state = 'active' OR v_state = 'active' THEN 'active'
      WHEN v.state = 'connecting' THEN 'connecting'
      ELSE v_state END,
    answered_at = COALESCE((p_event->>'answered_at')::timestamptz, answered_at,
      CASE WHEN v_status.state = 'active' THEN v_status.event_at END),
    ended_at = COALESCE((p_event->>'ended_at')::timestamptz, ended_at,
      CASE WHEN v_status.state = 'rejected' THEN v_status.event_at END),
    duration_seconds = COALESCE((p_event->>'duration_seconds')::integer, duration_seconds),
    error_message = COALESCE(p_event->>'error_message', error_message)
  WHERE id = v.id;
END $$;
REVOKE ALL ON FUNCTION public.ingest_whatsapp_call(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_whatsapp_call(uuid,jsonb) TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_calls;
  END IF;
END $$;
