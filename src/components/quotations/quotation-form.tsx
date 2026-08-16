'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import type { Quotation, QuotationStatus } from '@/lib/quotations/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// A status transition is a discrete, rep-initiated event ("mark this
// sent", "mark this won") -- not routine field editing -- so it PATCHes
// immediately on change rather than queueing into the same dirty/Save
// flow as the text fields below. That also means it's never blocked by
// (or blocks) an unrelated in-progress text edit.
const STATUS_OPTIONS: { value: QuotationStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'expired', label: 'Expired' },
];

export interface QuotationFields {
  clientName: string;
  clientPhone: string;
  clientCompany: string;
  location: string;
  projectName: string;
  subject: string;
  validUntil: string;
}

function fieldsFromQuotation(quotation: Quotation): QuotationFields {
  return {
    clientName: quotation.clientName ?? '',
    clientPhone: quotation.clientPhone ?? '',
    clientCompany: quotation.clientCompany ?? '',
    location: quotation.location ?? '',
    projectName: quotation.projectName ?? '',
    subject: quotation.subject ?? '',
    validUntil: quotation.validUntil ?? '',
  };
}

// PATCH /api/quotations/[id] forwards `body.fields` straight to
// `ctx.supabase.from('quotations').update(body.fields)` with no key
// transformation (see src/app/api/quotations/[id]/route.ts) — PostgREST
// validates every key against the real columns before executing
// anything, so this MUST use the DB's snake_case column names
// (client_name, client_phone, client_company, location, project_name,
// subject, valid_until — supabase/migrations/059_quotations.sql:163-181)
// or the entire update 400s atomically (PGRST204, unknown column), not
// just the mismatched fields. Same mapping already used by
// createQuotation in src/lib/quotations/crud.ts. Locked in by
// quotation-form.test.ts so this doesn't regress silently again.
//
// `valid_until` is a Postgres `date` column — PATCHing it with '' rather
// than null 400s ("invalid input syntax for type date"), which would
// make every save fail until a date was picked. Every optional text
// field gets the same trim-to-null treatment for consistency with the
// rest of the app (see contact-form.tsx).
export function toPatchPayload(fields: QuotationFields) {
  return {
    client_name: fields.clientName.trim() || null,
    client_phone: fields.clientPhone.trim() || null,
    client_company: fields.clientCompany.trim() || null,
    location: fields.location.trim() || null,
    project_name: fields.projectName.trim() || null,
    subject: fields.subject.trim() || null,
    valid_until: fields.validUntil || null,
  };
}

export function QuotationForm({
  quotation,
  onSaved,
}: {
  quotation: Quotation;
  onSaved: (q: Quotation) => void;
}) {
  const [fields, setFields] = useState<QuotationFields>(() => fieldsFromQuotation(quotation));
  const [savedFields, setSavedFields] = useState<QuotationFields>(() => fieldsFromQuotation(quotation));
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const dirty = JSON.stringify(fields) !== JSON.stringify(savedFields);

  function setField<K extends keyof QuotationFields>(key: K, value: QuotationFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: toPatchPayload(fields) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Failed to save (${res.status})`);
        return;
      }
      const updated = (await res.json()) as Quotation;
      onSaved(updated);
      setSavedFields(fields);
      toast.success('Quotation saved');
    } catch {
      toast.error('Failed to save — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  // PATCH /api/quotations/[id]'s body.fields whitelist (wave 1) accepts
  // `status` alongside the other quotations columns -- goes through the
  // exact same PATCH endpoint as save() above, just with its own field
  // and its own immediate trigger instead of the dirty/Save gate.
  async function updateStatus(next: QuotationStatus) {
    if (next === quotation.status || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { status: next } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Failed to update status (${res.status})`);
        return;
      }
      const updated = (await res.json()) as Quotation;
      onSaved(updated);
      toast.success(`Status updated to ${next}`);
    } catch {
      toast.error('Failed to update status — check your connection and try again.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="space-y-2 sm:w-48">
          <Label htmlFor="qf-status">Status</Label>
          <Select
            value={quotation.status}
            onValueChange={(v) => v && updateStatus(v as QuotationStatus)}
          >
            <SelectTrigger id="qf-status" className="w-full" disabled={updatingStatus}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="qf-client-name">Client name</Label>
            <Input
              id="qf-client-name"
              value={fields.clientName}
              onChange={(e) => setField('clientName', e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qf-client-phone">Client phone</Label>
            <Input
              id="qf-client-phone"
              type="tel"
              value={fields.clientPhone}
              onChange={(e) => setField('clientPhone', e.target.value)}
              placeholder="+974 5555 5555"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qf-client-company">Company</Label>
            <Input
              id="qf-client-company"
              value={fields.clientCompany}
              onChange={(e) => setField('clientCompany', e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qf-location">Location</Label>
            <Input
              id="qf-location"
              value={fields.location}
              onChange={(e) => setField('location', e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qf-project-name">Project</Label>
            <Input
              id="qf-project-name"
              value={fields.projectName}
              onChange={(e) => setField('projectName', e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qf-valid-until">Valid until</Label>
            <Input
              id="qf-valid-until"
              type="date"
              value={fields.validUntil}
              onChange={(e) => setField('validUntil', e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="qf-subject">Subject</Label>
            <Input
              id="qf-subject"
              value={fields.subject}
              onChange={(e) => setField('subject', e.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
