-- Aggregation happens before PostgREST's row limit. SECURITY INVOKER preserves
-- the same table RLS as the previous browser queries; no service-role bypass.
CREATE OR REPLACE FUNCTION public.dashboard_metrics(p_today timestamptz, p_yesterday timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'activeConversations', (SELECT jsonb_build_object(
      'current', count(*) FILTER (WHERE status = 'open'),
      'previous', count(*) FILTER (WHERE status = 'open' AND created_at >= p_today)
        - count(*) FILTER (WHERE status = 'open' AND created_at >= p_yesterday AND created_at < p_today)
    ) FROM conversations),
    'newContactsToday', (SELECT jsonb_build_object(
      'current', count(*) FILTER (WHERE created_at >= p_today),
      'previous', count(*) FILTER (WHERE created_at >= p_yesterday AND created_at < p_today)
    ) FROM contacts WHERE created_at >= p_yesterday),
    'openDealsValue', (SELECT coalesce(sum(value),0) FROM deals WHERE status = 'open'),
    'openDealsCount', (SELECT count(*) FROM deals WHERE status = 'open'),
    'messagesSentToday', (SELECT jsonb_build_object(
      'current', count(*) FILTER (WHERE created_at >= p_today),
      'previous', count(*) FILTER (WHERE created_at >= p_yesterday AND created_at < p_today)
    ) FROM messages WHERE sender_type = 'agent' AND created_at >= p_yesterday)
  ) WHERE auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_message_series(p_start timestamptz, p_days integer, p_timezone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH days AS (
    SELECT (p_start AT TIME ZONE p_timezone)::date + n AS day
    FROM generate_series(0, least(greatest(p_days,1),90)-1) n
  ), buckets AS (
    SELECT (created_at AT TIME ZONE p_timezone)::date AS day,
      count(*) FILTER (WHERE sender_type = 'customer') AS incoming,
      count(*) FILTER (WHERE sender_type <> 'customer') AS outgoing
    FROM messages WHERE created_at >= p_start GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',d.day,
    'incoming',coalesce(b.incoming,0),'outgoing',coalesce(b.outgoing,0)) ORDER BY d.day),'[]'::jsonb)
  FROM days d LEFT JOIN buckets b USING(day) WHERE auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_pipeline_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH totals AS (
    SELECT stage_id,count(*) AS deal_count,coalesce(sum(value),0) AS total_value
    FROM deals WHERE status = 'open' GROUP BY stage_id
  ), slices AS (
    SELECT s.id,s.name,coalesce(nullif(s.color,''),'#64748b') AS color,
      t.deal_count,t.total_value,s.position
    FROM pipeline_stages s JOIN totals t ON t.stage_id=s.id
  )
  SELECT jsonb_build_object('stages',coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'name',name,'color',color,'dealCount',deal_count,'totalValue',total_value
  ) ORDER BY position,id),'[]'::jsonb),'totalValue',coalesce(sum(total_value),0))
  FROM slices WHERE auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_response_time(
  p_start timestamptz, p_this_week timestamptz, p_last_week timestamptz, p_timezone text
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH numbered AS (
    SELECT conversation_id, sender_type, created_at,
      count(*) FILTER (WHERE sender_type <> 'customer') OVER (
        PARTITION BY conversation_id ORDER BY created_at,id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS reply_group
    FROM messages WHERE created_at >= p_start
  ), paired AS (
    SELECT min(created_at) FILTER (WHERE sender_type='customer') AS customer_at,
      min(created_at) FILTER (WHERE sender_type<>'customer') AS response_at
    FROM numbered GROUP BY conversation_id,reply_group
  ), samples AS (
    SELECT customer_at,extract(epoch FROM (response_at-customer_at))/60.0 AS minutes,
      extract(isodow FROM customer_at AT TIME ZONE p_timezone)::integer-1 AS dow
    FROM paired WHERE customer_at IS NOT NULL AND response_at >= customer_at
  ), buckets AS (
    SELECT d.dow,avg(s.minutes) AS avg_minutes,count(s.minutes) AS samples
    FROM generate_series(0,6) d(dow) LEFT JOIN samples s USING(dow) GROUP BY d.dow
  )
  SELECT jsonb_build_object(
    'buckets',(SELECT jsonb_agg(jsonb_build_object('dow',dow,'avgMinutes',avg_minutes,'samples',samples) ORDER BY dow) FROM buckets),
    'thisWeekAvg',(SELECT avg(minutes) FROM samples WHERE customer_at >= p_this_week),
    'lastWeekAvg',(SELECT avg(minutes) FROM samples WHERE customer_at >= p_last_week AND customer_at < p_this_week)
  ) WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.dashboard_metrics(timestamptz,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dashboard_message_series(timestamptz,integer,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dashboard_pipeline_summary() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dashboard_response_time(timestamptz,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_message_series(timestamptz,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_pipeline_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_response_time(timestamptz,timestamptz,timestamptz,text) TO authenticated;
