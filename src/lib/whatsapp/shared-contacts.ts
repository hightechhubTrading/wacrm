/** Contact objects carried by an incoming WhatsApp contacts message. */
export interface SharedContact {
  name?: { formatted_name?: string; first_name?: string; middle_name?: string; last_name?: string; prefix?: string; suffix?: string };
  phones?: Array<{ phone?: string; wa_id?: string; type?: string }>;
  emails?: Array<{ email?: string; type?: string }>;
  org?: { company?: string; department?: string; title?: string };
  addresses?: Array<{ street?: string; city?: string; state?: string; zip?: string; country?: string; type?: string }>;
  urls?: Array<{ url?: string; type?: string }>;
  birthday?: string;
}

/** Store readable details using the existing text-message schema. */
export function formatSharedContacts(contacts: SharedContact[] | undefined): string {
  const label = (value: string | undefined, type?: string) => value ? `${value}${type ? ` (${type})` : ''}` : '';
  return contacts?.map((contact) => {
    const name = contact.name;
    const fullName = name?.formatted_name || [name?.prefix, name?.first_name, name?.middle_name, name?.last_name, name?.suffix].filter(Boolean).join(' ');
    return [
      fullName,
      ...((contact.phones ?? []).map(p => label(p.phone || (p.wa_id ? `+${p.wa_id}` : undefined), p.type))),
      ...((contact.emails ?? []).map(e => label(e.email, e.type))),
      [contact.org?.company, contact.org?.department, contact.org?.title].filter(Boolean).join(' · '),
      ...((contact.addresses ?? []).map(a => label([a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(', '), a.type))),
      ...((contact.urls ?? []).map(u => label(u.url, u.type))),
      contact.birthday,
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n') || '[Contact shared without details]';
}
