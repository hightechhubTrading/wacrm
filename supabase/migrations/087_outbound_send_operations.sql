-- Dashboard send-operation ledger. No customer content; only request fingerprints.
-- A claimed operation is never automatically reclaimed after a timeout: Meta may
-- have accepted it. Only the server can claim or settle operations.
CREATE TABLE public.outbound_send_operations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  state text NOT NULL DEFAULT 'sending' CHECK (state IN ('sending','accepted','sent','rejected','unknown')),
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  whatsapp_message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbound_send_operations_scope ON public.outbound_send_operations(account_id,user_id,created_at DESC);
ALTER TABLE public.outbound_send_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_send_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.outbound_send_operations TO authenticated;
GRANT ALL ON public.outbound_send_operations TO service_role;
CREATE POLICY outbound_send_operations_read ON public.outbound_send_operations
FOR SELECT TO authenticated USING (
  user_id=auth.uid() AND public.is_account_member(account_id,'agent')
  AND EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id=conversation_id AND c.account_id=outbound_send_operations.account_id)
);
