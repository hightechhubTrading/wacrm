-- One authenticated round trip for profile plus account, without PostgREST FK
-- embeds or cross-request authorization caching. LEFT JOIN preserves a readable
-- own profile when account RLS hides its metadata; server routes still reject it.
CREATE OR REPLACE FUNCTION public.account_profile()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'profile',jsonb_build_object('id',p.id,'user_id',p.user_id,'full_name',p.full_name,
   'email',p.email,'avatar_url',p.avatar_url,'role',p.role,'beta_features',p.beta_features,
   'theme',p.theme,'mode',p.mode,'locale',p.locale,'account_id',p.account_id,
   'account_role',p.account_role,'phone',p.phone),
  'account',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'name',a.name,'default_currency',a.default_currency) END
 ) FROM profiles p LEFT JOIN accounts a ON a.id=p.account_id
 WHERE p.user_id=auth.uid() LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.account_profile() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.account_profile() TO authenticated;
