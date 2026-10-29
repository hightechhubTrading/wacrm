-- Sales Today: exact reply queue, independent of unread state or AI priority.
-- Read-only and caller RLS applies to conversations, messages and contacts.
CREATE FUNCTION public.sales_today_replies(p_account uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH waiting AS MATERIALIZED (
    SELECT c.id, latest.content_text AS last_message_text,
      latest.created_at AS last_message_at,
      CASE WHEN ct.id IS NULL THEN NULL ELSE
        jsonb_build_object('name',ct.name,'phone',ct.phone) END AS contact
    FROM conversations c
    JOIN LATERAL (
      SELECT m.sender_type,m.content_text,m.created_at,m.id
      FROM messages m
      WHERE m.conversation_id=c.id
        AND m.sender_type IN ('customer','agent','bot') AND m.status<>'failed'
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1
    ) latest ON latest.sender_type='customer'
    LEFT JOIN contacts ct ON ct.id=c.contact_id AND ct.account_id=c.account_id
    WHERE c.account_id=p_account AND c.status<>'closed'
      AND is_account_member(p_account,'agent')
  ), preview AS (
    SELECT * FROM waiting ORDER BY last_message_at ASC,id ASC LIMIT 6
  )
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.last_message_at ASC,p.id ASC) FROM preview p),'[]'::jsonb),
    'count',(SELECT count(*) FROM waiting)
  );
$$;
REVOKE ALL ON FUNCTION public.sales_today_replies(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_today_replies(uuid) TO authenticated,service_role;
