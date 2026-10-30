'use client';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  parseSavedInboxViews,
  type InboxQuery,
  type SavedInboxView,
} from '@/lib/inbox/query-state';

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener('crm-inbox-views', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener('crm-inbox-views', listener);
  };
}
export function SavedViews({
  query,
  onApply,
  canReadSales,
}: {
  query: InboxQuery;
  onApply: (query: InboxQuery) => void;
  canReadSales: boolean;
}) {
  const { accountId, user } = useAuth();
  if (!accountId || !user) return null;
  return (
    <ScopedSavedViews
      key={`${accountId}:${user.id}`}
      storageKey={`wacrm:inbox-views:v1:${accountId}:${user.id}`}
      query={query}
      onApply={onApply}
      canReadSales={canReadSales}
    />
  );
}
function ScopedSavedViews({
  storageKey,
  query,
  onApply,
  canReadSales,
}: {
  storageKey: string;
  query: InboxQuery;
  onApply: (query: InboxQuery) => void;
  canReadSales: boolean;
}) {
  const t = useTranslations('Inbox.savedViews');
  const snapshot = useCallback(() => {
    try {
      return localStorage.getItem(storageKey) ?? '[]';
    } catch {
      return '[]';
    }
  }, [storageKey]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => '[]');
  const views = useMemo(
    () => parseSavedInboxViews(raw, canReadSales),
    [raw, canReadSales]
  );
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(''),
    [error, setError] = useState('');
  const active = views.find(
    (view) => JSON.stringify(view.query) === JSON.stringify(query)
  );
  function persist(next: SavedInboxView[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event('crm-inbox-views'));
      setError('');
      return true;
    } catch {
      setError(t('saveFailed'));
      return false;
    }
  }
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm py-2 focus-visible:outline-2">
        {t('title')}
        {active ? ` · ${active.name}` : ''}
      </summary>
      <div className="space-y-2 py-2">
        <p className="text-muted-foreground text-xs">{t('deviceHint')}</p>
        <div className="flex gap-2">
          <select
            aria-label={t('choose')}
            value={active?.id ?? ''}
            onChange={(event) => {
              const selected = views.find((v) => v.id === event.target.value);
              if (selected) onApply(selected.query);
            }}
            className="border-border bg-background min-w-0 flex-1 rounded-md border px-2 py-2 text-sm"
          >
            <option value="">{t('choose')}</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
          {active && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('delete', { name: active.name })}
              onClick={() => persist(views.filter((v) => v.id !== active.id))}
            >
              {t('deleteShort')}
            </Button>
          )}
        </div>
        {!editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {t('saveCurrent')}
          </Button>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const label = name.trim();
              if (!label) {
                setError(t('nameRequired'));
                return;
              }
              if (views.length >= 20) {
                setError(t('limit'));
                return;
              }
              if (
                views.some(
                  (v) =>
                    v.name.toLocaleLowerCase() === label.toLocaleLowerCase()
                )
              ) {
                setError(t('duplicate'));
                return;
              }
              if (
                persist([
                  ...views,
                  { id: crypto.randomUUID(), name: label, query },
                ])
              ) {
                setEditing(false);
                setName('');
              }
            }}
          >
            <Label htmlFor="inbox-view-name">{t('name')}</Label>
            <Input
              id="inbox-view-name"
              maxLength={64}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" type="submit">
                {t('save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
              >
                {t('cancel')}
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
