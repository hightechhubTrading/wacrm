-- Bounded pipeline data with full-result filters/facets. Existing table RLS
-- remains authoritative; the function never runs with elevated privileges.
CREATE OR REPLACE FUNCTION public.pipeline_list(
 p_pipeline uuid, p_filters jsonb DEFAULT '{}', p_view text DEFAULT 'board',
 p_page integer DEFAULT 0, p_stage_pages jsonb DEFAULT '{}',
 p_today date DEFAULT current_date, p_week_end date DEFAULT current_date+7,
 p_fallback_currency text DEFAULT 'USD'
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH pipeline_scope AS MATERIALIZED (
  SELECT id,account_id FROM pipelines WHERE id=p_pipeline AND is_account_member(account_id)
 ), visible_deals AS MATERIALIZED (
  SELECT d.* FROM deals d JOIN pipeline_scope pl ON pl.id=d.pipeline_id AND pl.account_id=d.account_id
 ), visible_profiles AS MATERIALIZED (
  SELECT id,user_id,account_id,full_name,avatar_url FROM profiles WHERE account_id IN(SELECT account_id FROM pipeline_scope)
 ), visible_contacts AS MATERIALIZED (
  SELECT c.* FROM contacts c WHERE id IN(SELECT contact_id FROM visible_deals)
 ), visible_conversations AS MATERIALIZED (
  SELECT c.* FROM conversations c WHERE contact_id IN(SELECT contact_id FROM visible_deals) OR id IN(SELECT conversation_id FROM visible_deals)
 ), latest_conversation AS MATERIALIZED (
  SELECT DISTINCT ON(contact_id) id,contact_id FROM visible_conversations ORDER BY contact_id,coalesce(last_message_at,updated_at) DESC,id
 ), visible_tags AS MATERIALIZED (
  SELECT * FROM tags WHERE account_id IN(SELECT account_id FROM pipeline_scope)
 ), contact_tag_data AS MATERIALIZED (
  SELECT link.contact_id,jsonb_agg(to_jsonb(t) ORDER BY t.name,t.id) AS tags
  FROM contact_tags link JOIN visible_tags t ON t.id=link.tag_id
  WHERE link.contact_id IN(SELECT contact_id FROM visible_deals) GROUP BY link.contact_id
 ), base AS MATERIALIZED (
  SELECT d.*, ct.name AS contact_name,ct.phone AS contact_phone,
   cv.id AS customer_conversation_id,cv.assigned_agent_id AS conversation_user,
   CASE WHEN cv.id IS NOT NULL THEN CASE WHEN cv.assigned_agent_id IS NOT NULL THEN coalesce(cp.id::text,'user:'||cv.assigned_agent_id::text) END ELSE d.assigned_to::text END AS owner_key,
   CASE WHEN cv.id IS NOT NULL THEN cp.full_name ELSE dp.full_name END AS owner_name,
   cp.id AS conversation_profile,cp.avatar_url AS conversation_avatar,
   coalesce(t.tags,'[]'::jsonb) AS tag_data,
   coalesce(d.status::text,'open')='open' AND d.expected_close_date<p_today AS overdue
  FROM visible_deals d
  LEFT JOIN visible_contacts ct ON ct.id=d.contact_id
  LEFT JOIN visible_profiles dp ON dp.id=d.assigned_to
  LEFT JOIN latest_conversation latest ON d.conversation_id IS NULL AND latest.contact_id=d.contact_id
  LEFT JOIN visible_conversations cv ON cv.id=coalesce(d.conversation_id,latest.id)
  LEFT JOIN visible_profiles cp ON cp.user_id=cv.assigned_agent_id AND cp.account_id=d.account_id
  LEFT JOIN contact_tag_data t ON t.contact_id=d.contact_id
 ), candidates AS MATERIALIZED (
  SELECT b.* FROM base b WHERE
   (coalesce(p_filters->>'status','all')='all' OR coalesce(status::text,'open')=p_filters->>'status')
   AND (coalesce(p_filters->>'owner','')='' OR (p_filters->>'owner'='__unassigned__' AND owner_key IS NULL) OR owner_key=p_filters->>'owner')
   AND (coalesce(p_filters->>'stage','')='' OR stage_id::text=p_filters->>'stage')
   AND (coalesce(p_filters->>'currency','')='' OR coalesce(nullif(currency,''),p_fallback_currency)=p_filters->>'currency')
   AND (coalesce(btrim(p_filters->>'query'),'')='' OR
    strpos(lower(coalesce(title,'')),lower(btrim(p_filters->>'query')))>0 OR
    strpos(lower(coalesce(contact_name,'')),lower(btrim(p_filters->>'query')))>0 OR
    strpos(lower(coalesce(contact_phone,'')),lower(btrim(p_filters->>'query')))>0 OR
    strpos(lower(coalesce(owner_name,'')),lower(btrim(p_filters->>'query')))>0 OR
    strpos(lower(coalesce(notes,'')),lower(btrim(p_filters->>'query')))>0 OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(tag_data) t WHERE strpos(lower(t->>'name'),lower(btrim(p_filters->>'query')))>0))
   AND (coalesce(p_filters->>'due','all')='all'
    OR (p_filters->>'due'='undated' AND expected_close_date IS NULL)
    OR (coalesce(status::text,'open')='open' AND (
     (p_filters->>'due'='overdue' AND overdue)
     OR (p_filters->>'due'='today' AND expected_close_date=p_today)
     OR (p_filters->>'due'='week' AND expected_close_date BETWEEN p_today AND p_week_end))))
 ), filtered AS MATERIALIZED (
  SELECT * FROM candidates WHERE coalesce(p_filters->>'tag','')=''
   OR (p_filters->>'tag'='__untagged__' AND jsonb_array_length(tag_data)=0)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(tag_data) t WHERE t->>'id'=p_filters->>'tag')
 ), ranked AS MATERIALIZED (
  SELECT f.*,row_number() OVER (ORDER BY
   CASE WHEN p_filters->>'sort'='oldest' THEN created_at END ASC,
   CASE WHEN p_filters->>'sort'='updated' THEN coalesce(updated_at,created_at) END DESC,
   CASE WHEN p_filters->>'sort'='closing' THEN expected_close_date END ASC NULLS LAST,
   CASE WHEN p_filters->>'sort'='title' THEN title END ASC,
   CASE WHEN p_filters->>'sort'='value' THEN coalesce(nullif(currency,''),p_fallback_currency) END ASC,
   CASE WHEN p_filters->>'sort'='value' THEN coalesce(value,0) END DESC,
   CASE WHEN coalesce(p_filters->>'sort','newest') NOT IN ('oldest','updated','closing','title','value') THEN created_at END DESC,id
  ) AS rn FROM filtered f
 ), stages AS MATERIALIZED (
  SELECT stage_id,count(*) AS total,
   least(greatest(coalesce((p_stage_pages->>stage_id::text)::integer,0),0),greatest((count(*)-1)/6,0)) AS page
  FROM ranked GROUP BY stage_id
 ), numbered AS (
  SELECT r.*,row_number() OVER(PARTITION BY r.stage_id ORDER BY rn) AS stage_rn FROM ranked r
 ), bounds AS (
  SELECT CASE WHEN p_view='list' THEN 25 WHEN p_view='export' THEN 100 ELSE 6 END AS size,
   (SELECT count(*) FROM ranked) AS total
 ), position AS (
  SELECT size,total,least(greatest(coalesce(p_page,0),0),greatest((total-1)/size,0)) AS page FROM bounds
 ), selected AS MATERIALIZED (
  SELECT n.* FROM numbered n JOIN stages s ON s.stage_id=n.stage_id CROSS JOIN position pos
  WHERE (p_view='board' AND stage_rn BETWEEN s.page*6+1 AND (s.page+1)*6)
   OR (p_view<>'board' AND rn BETWEEN pos.page*pos.size+1 AND (pos.page+1)*pos.size)
 ), tag_matches AS (
  SELECT c.id,c.status,c.overdue,coalesce(t->>'id','__untagged__') AS tag_id,t AS tag
  FROM candidates c LEFT JOIN LATERAL jsonb_array_elements(c.tag_data) t ON true
 ), tag_groups AS (
  SELECT tag_id,(jsonb_agg(tag)->0) AS tag,count(*) AS total,
   count(*) FILTER(WHERE coalesce(status::text,'open')='open') AS open,
   count(*) FILTER(WHERE overdue) AS overdue FROM tag_matches GROUP BY tag_id
 ), tags AS (
  SELECT DISTINCT t AS tag FROM base CROSS JOIN LATERAL jsonb_array_elements(tag_data) t
 ), owners AS (
  SELECT DISTINCT owner_key,owner_name FROM base WHERE owner_key IS NOT NULL
 )
 SELECT jsonb_build_object(
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',s.id,'user_id',s.user_id,'account_id',s.account_id,'pipeline_id',s.pipeline_id,'stage_id',s.stage_id,
   'contact_id',s.contact_id,'conversation_id',s.conversation_id,'title',s.title,'value',s.value,'currency',s.currency,
   'assigned_to',s.assigned_to,'expected_close_date',s.expected_close_date,'status',s.status,'created_at',s.created_at,'updated_at',s.updated_at,
   'customerConversationId',s.customer_conversation_id,
   'conversationOwner',CASE WHEN s.customer_conversation_id IS NOT NULL THEN jsonb_build_object('userId',s.conversation_user,'profileId',s.conversation_profile,'fullName',s.owner_name,'avatarUrl',s.conversation_avatar) END,
   'assignee',(SELECT jsonb_build_object('id',p.id,'user_id',p.user_id,'full_name',p.full_name,'avatar_url',p.avatar_url) FROM visible_profiles p WHERE p.id=s.assigned_to),
   'contact',(SELECT to_jsonb(c)||jsonb_build_object('tags',s.tag_data,'customValues',coalesce((
    SELECT jsonb_agg(jsonb_build_object('field_name',f.field_name,'value',v.value)) FROM contact_custom_values v JOIN custom_fields f ON f.id=v.custom_field_id
    WHERE v.contact_id=c.id AND f.ai_collectible AND nullif(btrim(v.value),'') IS NOT NULL),'[]'::jsonb)) FROM visible_contacts c WHERE c.id=s.contact_id),
   'aiSummary',(SELECT CASE WHEN nullif(btrim(summary.text),'') IS NOT NULL THEN jsonb_build_object('text',btrim(summary.text),'at',summary.at,'conversationId',c.id) END
    FROM visible_conversations c LEFT JOIN ai_sales_assistance a ON a.conversation_id=c.id AND a.status='ready'
    CROSS JOIN LATERAL (SELECT CASE WHEN nullif(btrim(a.analysis->>'summary'),'') IS NOT NULL AND (nullif(btrim(c.ai_context_summary),'') IS NULL OR a.updated_at>coalesce(c.ai_context_summary_at,'-infinity'::timestamptz))
     THEN a.analysis->>'summary' ELSE coalesce(nullif(btrim(c.ai_context_summary),''),nullif(btrim(c.ai_handoff_summary),'')) END AS text,
     CASE WHEN nullif(btrim(a.analysis->>'summary'),'') IS NOT NULL AND (nullif(btrim(c.ai_context_summary),'') IS NULL OR a.updated_at>coalesce(c.ai_context_summary_at,'-infinity'::timestamptz)) THEN a.updated_at ELSE CASE WHEN nullif(btrim(c.ai_context_summary),'') IS NOT NULL THEN c.ai_context_summary_at END END AS at) summary
    WHERE c.id=s.customer_conversation_id LIMIT 1)
  ) ORDER BY rn) FROM selected s),'[]'::jsonb),
  'total',(SELECT total FROM position),'page',(SELECT page FROM position),
  'pipelineTotal',(SELECT count(*) FROM base),
  'stageCounts',coalesce((SELECT jsonb_object_agg(stage_id,total) FROM stages),'{}'::jsonb),
  'stagePages',coalesce((SELECT jsonb_object_agg(stage_id,page) FROM stages),'{}'::jsonb),
  'summary',(SELECT jsonb_build_object('open',count(*) FILTER(WHERE coalesce(status::text,'open')='open'),'won',count(*) FILTER(WHERE status::text='won'),'overdue',count(*) FILTER(WHERE overdue),'unassigned',count(*) FILTER(WHERE owner_key IS NULL AND coalesce(status::text,'open')='open')) FROM filtered),
  'tagSummary',(SELECT jsonb_build_object('total',count(*),'open',count(*) FILTER(WHERE coalesce(status::text,'open')='open'),'overdue',count(*) FILTER(WHERE overdue)) FROM candidates),
  'tags',coalesce((SELECT jsonb_agg(tag ORDER BY tag->>'name',tag->>'id') FROM tags),'[]'::jsonb),
  'owners',coalesce((SELECT jsonb_agg(jsonb_build_array(owner_key,owner_name) ORDER BY owner_name,owner_key) FROM owners),'[]'::jsonb),
  'tagGroups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',tag_id,'tag',tag,'total',total,'open',open,'overdue',overdue) ORDER BY tag->>'name' NULLS LAST,tag_id) FROM tag_groups),'[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION public.pipeline_list(uuid,jsonb,text,integer,jsonb,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pipeline_list(uuid,jsonb,text,integer,jsonb,date,date,text) TO authenticated;
