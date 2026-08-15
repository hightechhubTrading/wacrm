import { describe, expect, it } from 'vitest';
import { toPatchPayload, type QuotationFields } from './quotation-form';

// Locks in the bug found in Task 12 review: PATCH /api/quotations/[id]
// forwards `body.fields` straight to
// `ctx.supabase.from('quotations').update(body.fields)` with no key
// transformation (src/app/api/quotations/[id]/route.ts), and the real
// `quotations` columns are snake_case (client_name, client_phone,
// client_company, location, project_name, subject, valid_until —
// supabase/migrations/059_quotations.sql:163-181; also the exact
// contract Task 6's own route test locks in at
// src/app/api/quotations/[id]/route.test.ts:171,180). Sending camelCase
// keys makes PostgREST reject the whole update atomically (PGRST204,
// unknown column) — every field, every time, not just the mismatched
// ones. toPatchPayload is the only thing standing between the form's
// camelCase state and that wire contract.
describe('toPatchPayload', () => {
  const fields: QuotationFields = {
    clientName: 'Acme Co',
    clientPhone: '+974 5555 1234',
    clientCompany: 'Acme Trading',
    location: 'Doha',
    projectName: 'Villa 12',
    subject: 'Sliding doors',
    validUntil: '2026-09-01',
  };

  it('emits snake_case keys matching the quotations table columns', () => {
    const payload = toPatchPayload(fields);

    expect(Object.keys(payload).sort()).toEqual(
      [
        'client_name',
        'client_phone',
        'client_company',
        'location',
        'project_name',
        'subject',
        'valid_until',
      ].sort(),
    );
    // No leftover camelCase keys — this is exactly the failure mode:
    // PostgREST 400s the whole request if any unknown key is present.
    expect(payload).not.toHaveProperty('clientName');
    expect(payload).not.toHaveProperty('clientPhone');
    expect(payload).not.toHaveProperty('clientCompany');
    expect(payload).not.toHaveProperty('projectName');
    expect(payload).not.toHaveProperty('validUntil');
  });

  it('maps values through unchanged (trimmed) for populated fields', () => {
    const payload = toPatchPayload(fields);

    expect(payload).toEqual({
      client_name: 'Acme Co',
      client_phone: '+974 5555 1234',
      client_company: 'Acme Trading',
      location: 'Doha',
      project_name: 'Villa 12',
      subject: 'Sliding doors',
      valid_until: '2026-09-01',
    });
  });

  it('sends null, not empty string, for unset optional fields', () => {
    const empty: QuotationFields = {
      clientName: '',
      clientPhone: '',
      clientCompany: '',
      location: '',
      projectName: '',
      subject: '',
      validUntil: '',
    };

    const payload = toPatchPayload(empty);

    // valid_until is a Postgres `date` column — '' 400s
    // ("invalid input syntax for type date"); every other field gets
    // the same trim-to-null treatment for consistency.
    expect(payload).toEqual({
      client_name: null,
      client_phone: null,
      client_company: null,
      location: null,
      project_name: null,
      subject: null,
      valid_until: null,
    });
  });

  it('trims whitespace-only text fields down to null', () => {
    const payload = toPatchPayload({ ...fields, clientName: '   ', subject: '  \t ' });

    expect(payload.client_name).toBeNull();
    expect(payload.subject).toBeNull();
  });
});
