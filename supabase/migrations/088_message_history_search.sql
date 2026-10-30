-- Historical search and bounded result context. Caller message/conversation RLS applies.
CREATE INDEX messages_history_search_idx ON public.messages USING gin
 (to_tsvector('simple',coalesce(content_text,'')||' '||coalesce(transcript,'')));

CREATE FUNCTION public.search_inbox_messages(
 p_account uuid,p_query text,p_conversation uuid DEFAULT NULL,p_sender text DEFAULT NULL,
 p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,
 p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH query AS (
  SELECT plainto_tsquery('simple',p_query) AS q
  WHERE length(btrim(p_query)) BETWEEN 2 AND 200 AND is_account_member(p_account)
 ), matches AS MATERIALIZED (
  SELECT m.id,m.conversation_id,m.created_at,coalesce(m.created_at,'0001-01-01Z'::timestamptz) AS sort_at,m.sender_type,m.content_type,
   ct.name AS contact_name,ct.phone AS contact_phone,
   ts_headline('simple',coalesce(m.content_text,'')||' '||coalesce(m.transcript,''),q.q,
    'StartSel=⟦,StopSel=⟧,MaxWords=35,MinWords=12,MaxFragments=2') AS excerpt,
   CASE WHEN to_tsvector('simple',coalesce(m.content_text,''))@@q.q THEN 'message'
    WHEN to_tsvector('simple',coalesce(m.transcript,''))@@q.q THEN 'transcript' ELSE 'mixed' END AS source
  FROM messages m JOIN conversations c ON c.id=m.conversation_id
  LEFT JOIN contacts ct ON ct.id=c.contact_id AND ct.account_id=c.account_id CROSS JOIN query q
  WHERE c.account_id=p_account AND numnode(q.q)>0
   AND to_tsvector('simple',coalesce(m.content_text,'')||' '||coalesce(m.transcript,''))@@q.q
   AND (p_conversation IS NULL OR m.conversation_id=p_conversation)
   AND (p_sender IS NULL OR m.sender_type::text=p_sender)
   AND (p_from IS NULL OR m.created_at>=p_from) AND (p_to IS NULL OR m.created_at<p_to)
 ), eligible AS (
  SELECT * FROM matches WHERE p_cursor IS NULL
    OR (sort_at,id)<((p_cursor->>'created_at')::timestamptz,(p_cursor->>'id')::uuid)
  ORDER BY sort_at DESC,id DESC LIMIT least(greatest(p_limit,1),50)+1
 ), page AS (
  SELECT * FROM eligible ORDER BY sort_at DESC,id DESC LIMIT least(greatest(p_limit,1),50)
 ) SELECT jsonb_build_object(
  'items',coalesce((SELECT jsonb_agg(to_jsonb(p)-'sort_at' ORDER BY sort_at DESC,id DESC) FROM page p),'[]'::jsonb),
  'total',(SELECT count(*) FROM matches),
  'nextCursor',CASE WHEN (SELECT count(*) FROM eligible)>least(greatest(p_limit,1),50)
    THEN (SELECT jsonb_build_object('created_at',sort_at,'id',id) FROM page ORDER BY sort_at,id LIMIT 1) ELSE NULL END
 );
$$;

CREATE FUNCTION public.inbox_message_context(p_account uuid,p_conversation uuid,p_message uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH anchor AS MATERIALIZED (
  SELECT m.id,coalesce(m.created_at,'0001-01-01Z'::timestamptz) AS sort_at FROM messages m JOIN conversations c ON c.id=m.conversation_id
  WHERE c.account_id=p_account AND c.id=p_conversation AND m.id=p_message AND is_account_member(p_account)
 ), before_rows AS (
  SELECT m.* FROM messages m CROSS JOIN anchor a WHERE m.conversation_id=p_conversation
   AND (coalesce(m.created_at,'0001-01-01Z'::timestamptz),m.id)<=(a.sort_at,a.id) ORDER BY coalesce(m.created_at,'0001-01-01Z'::timestamptz) DESC,m.id DESC LIMIT 21
 ), after_rows AS (
  SELECT m.* FROM messages m CROSS JOIN anchor a WHERE m.conversation_id=p_conversation
   AND (coalesce(m.created_at,'0001-01-01Z'::timestamptz),m.id)>(a.sort_at,a.id) ORDER BY coalesce(m.created_at,'0001-01-01Z'::timestamptz),m.id LIMIT 20
 ), context AS (SELECT * FROM before_rows UNION ALL SELECT * FROM after_rows)
 SELECT jsonb_build_object('found',EXISTS(SELECT 1 FROM anchor),
  'messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY coalesce(created_at,'0001-01-01Z'::timestamptz),id) FROM context m),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.search_inbox_messages(uuid,text,uuid,text,timestamptz,timestamptz,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.inbox_message_context(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_inbox_messages(uuid,text,uuid,text,timestamptz,timestamptz,jsonb,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inbox_message_context(uuid,uuid,uuid) TO authenticated,service_role;
