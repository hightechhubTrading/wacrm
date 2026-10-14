-- Read-only sales workspace facts. Invoker RLS covers every underlying table.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_latest ON messages(conversation_id,created_at DESC,id DESC);
CREATE FUNCTION public.inbox_sales_context(p_account uuid,p_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'conversation_id',c.id,'last_sender',latest.sender_type,
 'followups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'due_at',f.due_at,'owner_id',f.owner_id,'owner_name',(SELECT full_name FROM profiles WHERE user_id=f.owner_id AND account_id=c.account_id LIMIT 1))) FROM ai_followups f WHERE f.conversation_id=c.id AND f.account_id=c.account_id AND f.status IN ('open','acknowledged','deferred')),'[]'::jsonb),
 'work',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'deal_id',h.deal_id,'reference',h.reference,'kind',h.kind,'status',h.status,'due_at',h.due_at,'responsible',h.responsible)) FROM group_handoffs h JOIN deals d ON d.id=h.deal_id WHERE h.account_id=c.account_id AND (d.conversation_id=c.id OR (d.conversation_id IS NULL AND d.contact_id=c.contact_id)) AND h.status NOT IN ('report_received','installed','cancelled')),'[]'::jsonb)
 )),'[]'::jsonb)
 FROM conversations c LEFT JOIN LATERAL (SELECT sender_type FROM messages m WHERE m.conversation_id=c.id AND sender_type IN ('customer','agent','bot') AND status<>'failed' ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
 WHERE c.account_id=p_account AND c.id=ANY(p_ids) AND cardinality(p_ids)<=500 AND is_account_member(p_account,'agent');
$$;
REVOKE ALL ON FUNCTION inbox_sales_context(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION inbox_sales_context(uuid,uuid[]) TO authenticated,service_role;
