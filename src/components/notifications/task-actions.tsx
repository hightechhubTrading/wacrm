'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { Notification } from '@/types';
import { toast } from 'sonner';
/** Actions use the existing task API, including its source access/state/evidence checks. */
export function NotificationTaskActions({
  notice,
  onChange,
}: {
  notice: Notification;
  onChange: () => void;
}) {
  const t = useTranslations('NotificationCenter');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState('acknowledged');
  const [value, setValue] = useState('');
  const [closed, setClosed] = useState(false);
  if (
    notice.resolved_at ||
    !notice.followup_id ||
    !notice.conversation_id ||
    closed
  )
    return null;
  const submit = async () => {
    setBusy(true);
    try {
      const due = action === 'deferred' ? new Date(value) : null;
      if (
        due &&
        (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now())
      )
        throw new Error('date');
      if (action === 'completed' && value.trim().length < 10)
        throw new Error('evidence');
      const result = await fetch(
        `/api/ai/followups/${notice.conversation_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: notice.followup_id,
            status: action,
            ...(action === 'completed' ? { completion_evidence: value } : {}),
            ...(due ? { due_at: due.toISOString() } : {}),
          }),
        }
      );
      if (!result.ok) throw new Error('update');
      toast.success(t('taskUpdated'));
      setClosed(action !== 'acknowledged');
      onChange();
    } catch {
      toast.error(t('taskFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer">{t('taskActions')}</summary>
      <div className="mt-2 flex max-w-xl flex-col items-start gap-2">
        <label>
          {t('taskActions')}
          <select
            className="border-input bg-background ms-2 rounded-md border p-2"
            value={action}
            disabled={busy}
            onChange={(e) => {
              setAction(e.target.value);
              setValue('');
            }}
          >
            {['acknowledged', 'completed', 'deferred'].map((v) => (
              <option key={v} value={v}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        {action === 'completed' && (
          <label className="w-full">
            {t('evidence')}
            <textarea
              className="border-input bg-background mt-1 block w-full rounded-md border p-2"
              value={value}
              minLength={10}
              maxLength={2000}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        {action === 'deferred' && (
          <label>
            {t('deferUntil')}
            <input
              type="datetime-local"
              className="border-input bg-background ms-2 rounded-md border p-2"
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <Button
          size="sm"
          disabled={busy || (action !== 'acknowledged' && !value.trim())}
          onClick={() => void submit()}
        >
          {t('apply')}
        </Button>
      </div>
    </details>
  );
}
