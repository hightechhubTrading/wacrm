-- Bounded inbox pages with global filters, counts and deterministic keysets.
-- All reads run under the caller's existing table RLS.
CREATE OR REPLACE FUNCTION public.inbox_list(
 p_account uuid, p_search text DEFAULT '', p_view text DEFAULT 'all',
 p_sort text DEFAULT 'priority', p_tags uuid[] DEFAULT '{}',
 p_company text DEFAULT NULL, p_agent text DEFAULT NULL,
 p_day_end timestamptz DEFAULT now(), p_cursor jsonb DEFAULT NULL,
 p_limit integer DEFAULT 50, p_sales boolean DEFAULT true, p_metadata_only boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH base AS MATERIALIZED (
  SELECT c.*,ct.name AS contact_name,ct.phone AS contact_phone,
    nullif(btrim(ct.company),'') AS company_name,
    CASE WHEN c.status='closed' THEN 3 WHEN c.ai_priority IN ('urgent','high') THEN 0
      WHEN c.unread_count>0 THEN 1 ELSE 2 END AS triage,
    p_sales AND is_account_member(c.account_id,'agent') AS can_sales
  FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
  WHERE c.account_id=p_account AND is_account_member(p_account)
 ), refined AS MATERIALIZED (
  SELECT b.* FROM base b
  WHERE (coalesce(p_search,'')='' OR strpos(lower(coalesce(contact_name,'')),lower(p_search))>0
    OR strpos(lower(coalesce(contact_phone,'')),lower(p_search))>0
    OR strpos(lower(coalesce(last_message_text,'')),lower(p_search))>0)
   AND (p_company IS NULL OR company_name=p_company)
   AND (p_agent IS NULL OR (p_agent='__unassigned__' AND assigned_agent_id IS NULL) OR assigned_agent_id::text=p_agent)
   AND (coalesce(cardinality(p_tags),0)=0 OR EXISTS(SELECT 1 FROM contact_tags t WHERE t.contact_id=b.contact_id AND t.tag_id=ANY(p_tags)))
 ), followups AS MATERIALIZED (
  SELECT f.conversation_id,count(*)>0 AS has_followups,
   coalesce(bool_or((f.owner_id IS NULL OR f.owner_id=auth.uid()) AND f.due_at<=p_day_end),false) AS due
  FROM ai_followups f JOIN refined r ON r.id=f.conversation_id AND r.can_sales
  WHERE f.account_id=p_account AND f.status IN ('open','acknowledged','deferred') GROUP BY f.conversation_id
 ), active_work AS MATERIALIZED (
  SELECT d.conversation_id,d.contact_id,h.kind,h.status,h.due_at
  FROM group_handoffs h JOIN deals d ON d.id=h.deal_id
  WHERE p_sales AND h.account_id=p_account AND h.status NOT IN ('report_received','installed','cancelled')
 ), work_matches AS (
  SELECT r.id,h.kind,h.status,h.due_at FROM refined r JOIN active_work h ON h.conversation_id=r.id WHERE r.can_sales
  UNION ALL
  SELECT r.id,h.kind,h.status,h.due_at FROM refined r JOIN active_work h ON h.conversation_id IS NULL AND h.contact_id=r.contact_id WHERE r.can_sales
 ), work AS MATERIALIZED (
  SELECT id,count(*)>0 AS has_work,
   coalesce(bool_or(kind='measurement' AND status<>'draft'),false) AS measurement,
   coalesce(bool_or(kind='workshop' AND status<>'draft'),false) AS workshop,
   coalesce(bool_or(due_at<=p_day_end),false) AS due FROM work_matches GROUP BY id
 ), facts AS MATERIALIZED (
  SELECT r.*,
   coalesce(latest.sender_type='customer',false) AS needs_reply,
   coalesce(latest.sender_type IN ('agent','bot') AND NOT coalesce(f.has_followups,false) AND NOT coalesce(w.has_work,false),false) AS waiting_customer,
   coalesce(f.due,false) OR coalesce(w.due,false) AS followup_today,
   coalesce(w.measurement,false) AS waiting_measurement,
   coalesce(w.workshop,false) AS waiting_workshop
  FROM refined r
  LEFT JOIN LATERAL (
    SELECT m.sender_type FROM messages m WHERE r.can_sales AND m.conversation_id=r.id
      AND m.sender_type IN ('customer','agent','bot') AND m.status<>'failed'
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1
  ) latest ON true
  LEFT JOIN followups f ON f.conversation_id=r.id
  LEFT JOIN work w ON w.id=r.id
 ), views AS MATERIALIZED (
  SELECT f.*,ARRAY_REMOVE(ARRAY[
   'all',CASE WHEN unread_count>0 THEN 'unread' END,
   CASE WHEN assigned_agent_id=auth.uid() THEN 'mine' END,
   CASE WHEN triage=0 THEN 'priority' END,
   CASE WHEN assigned_agent_id IS NULL THEN 'unassigned' END,status::text,
   CASE WHEN status<>'closed' AND needs_reply THEN 'needs_reply' END,
   CASE WHEN status<>'closed' AND waiting_customer THEN 'waiting_customer' END,
   CASE WHEN status<>'closed' AND followup_today THEN 'followup_today' END,
   CASE WHEN status<>'closed' AND waiting_measurement THEN 'waiting_measurement' END,
   CASE WHEN status<>'closed' AND waiting_workshop THEN 'waiting_workshop' END
  ],NULL) AS matched_views FROM facts f
 ), ordered AS MATERIALIZED (
  SELECT v.*,
   CASE WHEN p_sort='priority' THEN triage ELSE 0 END AS k1,
   CASE WHEN p_sort='priority' AND triage=0 AND ai_priority='high' THEN 1 ELSE 0 END AS k2,
   coalesce(extract(epoch FROM last_message_at),0)*CASE WHEN p_sort='oldest' THEN 1 ELSE -1 END AS kt
  FROM views v WHERE p_view=ANY(matched_views)
 ), page AS MATERIALIZED (
  SELECT * FROM ordered WHERE NOT p_metadata_only AND (p_cursor IS NULL OR
   (k1,k2,kt,id)>((p_cursor->>'k1')::integer,(p_cursor->>'k2')::integer,(p_cursor->>'kt')::numeric,(p_cursor->>'id')::uuid))
  ORDER BY k1,k2,kt,id LIMIT least(greatest(p_limit,1),100)
 ), counts AS (
  SELECT key,count(*) AS count FROM views CROSS JOIN LATERAL unnest(matched_views) key
   WHERE p_sales OR key NOT IN ('needs_reply','waiting_customer','followup_today','waiting_measurement','waiting_workshop') GROUP BY key
 )
 SELECT jsonb_build_object(
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',p.id,'user_id',p.user_id,'contact_id',p.contact_id,'status',p.status,
   'assigned_agent_id',p.assigned_agent_id,'last_message_text',p.last_message_text,
   'last_message_at',p.last_message_at,'unread_count',p.unread_count,'created_at',p.created_at,'updated_at',p.updated_at,
   'ai_priority',p.ai_priority,'ai_priority_reason',p.ai_priority_reason,
   'ai_autoreply_disabled',p.ai_autoreply_disabled,'ai_reply_count',p.ai_reply_count,
   'ai_handoff_summary',p.ai_handoff_summary,'ai_context_summary',p.ai_context_summary,
   'ai_context_summary_at',p.ai_context_summary_at,
   'ad_source_id',p.ad_source_id,'ad_headline',p.ad_headline,'ad_clicked_at',p.ad_clicked_at,
   'contact',(SELECT to_jsonb(ct) FROM contacts ct WHERE ct.id=p.contact_id)
  ) ORDER BY k1,k2,kt,p.id) FROM page p),'[]'::jsonb),
  'counts',coalesce((SELECT jsonb_object_agg(key,count) FROM counts),'{}'::jsonb),
  'total',(SELECT count(*) FROM ordered),
  'companies',coalesce((SELECT jsonb_agg(company_name ORDER BY company_name) FROM (SELECT DISTINCT company_name FROM base WHERE company_name IS NOT NULL) companies),'[]'::jsonb),
  'nextCursor',(SELECT jsonb_build_object('k1',last.k1,'k2',last.k2,'kt',last.kt,'id',last.id)
    FROM (SELECT * FROM page ORDER BY k1 DESC,k2 DESC,kt DESC,id DESC LIMIT 1) last
    WHERE EXISTS(SELECT 1 FROM ordered o WHERE (o.k1,o.k2,o.kt,o.id)>(last.k1,last.k2,last.kt,last.id)))
 );
$$;
REVOKE ALL ON FUNCTION public.inbox_list(uuid,text,text,text,uuid[],text,text,timestamptz,jsonb,integer,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inbox_list(uuid,text,text,text,uuid[],text,text,timestamptz,jsonb,integer,boolean,boolean) TO authenticated;
