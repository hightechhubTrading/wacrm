import {
  mobileConversation,
  mobileResponse,
  mobilePreflight,
} from '@/lib/mobile/conversation';
export const OPTIONS = mobilePreflight;
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const fail = (status: number, error: string) =>
    mobileResponse(request, Response.json({ error }, { status }));
  try {
    const access = await mobileConversation(request, (await context.params).id);
    if ('response' in access) return access.response;
    const { db, profile, conversation } = access;
    const { data: contact, error } = await db
      .from('contacts')
      .select('id,name,phone,email,company,avatar_url')
      .eq('id', conversation.contact_id)
      .eq('account_id', profile.account_id)
      .maybeSingle();
    if (error || !contact) return fail(404, 'Contact unavailable');
    const [tags, notes] = await Promise.all([
      db
        .from('contact_tags')
        .select('tag:tags(id,name)')
        .eq('contact_id', contact.id)
        .limit(100),
      db
        .from('contact_notes')
        .select('id,note_text,created_at')
        .eq('contact_id', contact.id)
        .eq('account_id', profile.account_id)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(50),
    ]);
    if (tags.error || notes.error)
      return fail(503, 'Contact details could not be loaded');
    return mobileResponse(
      request,
      Response.json({
        contact,
        tags: (tags.data ?? []).flatMap((row) => (row.tag ? [row.tag] : [])),
        notes: notes.data ?? [],
        notesLimit: 50,
      })
    );
  } catch {
    return fail(503, 'Contact details are temporarily unavailable');
  }
}
