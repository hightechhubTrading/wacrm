import { describe, expect, it } from 'vitest';
import { formatSharedContacts } from './shared-contacts';

describe('incoming shared contacts', () => {
  it('keeps multiple contacts and their available details readable', () => {
    expect(formatSharedContacts([
      { name: { formatted_name: 'أحمد' }, phones: [{ phone: '+974 5557 5558', type: 'WORK' }, { wa_id: '97470099850' }], emails: [{ email: 'a@example.com' }], org: { company: 'HTH' } },
      { name: { first_name: 'Jane', last_name: 'Doe' }, phones: [{ phone: '+49123456789' }] },
    ])).toBe('أحمد\n+974 5557 5558 (WORK)\n+97470099850\na@example.com\nHTH\n\nJane Doe\n+49123456789');
  });
  it('handles absent or empty details without an unsupported message', () => {
    expect(formatSharedContacts(undefined)).toBe('[Contact shared without details]');
    expect(formatSharedContacts([{}])).toBe('[Contact shared without details]');
  });
});
