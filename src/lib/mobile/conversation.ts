import { createRequestClient } from '@/lib/supabase/request';
import { isAccountRole } from '@/lib/auth/roles';
export function mobileResponse(request: Request, response: Response) {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (request.headers.get('origin') === 'https://localhost') {
    response.headers.set('Access-Control-Allow-Origin', 'https://localhost');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'authorization, content-type'
    );
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  return response;
}
export function mobilePreflight(request: Request) {
  return mobileResponse(
    request,
    new Response(null, {
      status: request.headers.get('origin') === 'https://localhost' ? 204 : 403,
    })
  );
}
export async function mobileConversation(request: Request, id: string) {
  const fail = (status: number, error: string) => ({
    response: mobileResponse(request, Response.json({ error }, { status })),
  });
  if (
    request.headers.has('origin') &&
    request.headers.get('origin') !== 'https://localhost'
  )
    return fail(403, 'Origin not allowed');
  if (
    !/^Bearer [A-Za-z0-9._-]+$/.test(request.headers.get('authorization') ?? '')
  )
    return fail(401, 'User session required');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return fail(400, 'Invalid conversation');
  const db = await createRequestClient(request);
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) return fail(401, 'Sign in required');
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('account_id,account_role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (
    profileError ||
    !profile?.account_id ||
    !isAccountRole(profile.account_role)
  )
    return fail(403, 'Account unavailable');
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('id,contact_id,unread_count,last_message_at')
    .eq('id', id)
    .eq('account_id', profile.account_id)
    .maybeSingle();
  if (conversationError || !conversation)
    return fail(404, 'Conversation unavailable');
  return { db, profile, conversation };
}
