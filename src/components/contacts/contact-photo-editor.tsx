'use client';
import { useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactPhotoVersion } from '@/lib/contacts/photo';

export function ContactPhotoEditor({
  contact,
  canEdit,
  onChange,
}: {
  contact: {
    id: string;
    name?: string | null;
    phone: string;
    avatar_url?: string | null;
  };
  canEdit: boolean;
  onChange: (url: string | null) => void;
}) {
  const ar = useLocale().startsWith('ar');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState('');
  const initials = (contact.name || contact.phone)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => Array.from(s)[0])
    .join('')
    .toUpperCase();
  async function save(file?: File) {
    if (busy || !canEdit) return;
    if (
      file &&
      (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 5 * 1024 * 1024 ||
        !file.size)
    ) {
      setError(
        ar
          ? 'اختر صورة JPG أو PNG أو WebP بحجم أقل من 5 ميغابايت.'
          : 'Choose a JPG, PNG or WebP photo smaller than 5 MB.'
      );
      if (input.current) input.current.value = '';
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/contacts/${contact.id}/photo`, {
        method: file ? 'POST' : 'DELETE',
        headers: {
          'If-Match': JSON.stringify(
            contactPhotoVersion(contact.avatar_url, contact.id)
          ),
          ...(file ? { 'Content-Type': file.type } : {}),
        },
        ...(file ? { body: file } : {}),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? ar
              ? 'تغيرت الصورة. حدّث الصفحة وحاول مرة أخرى.'
              : 'The photo changed. Refresh and try again.'
            : ar
              ? 'تعذر حفظ الصورة. حاول مرة أخرى.'
              : data.error || 'Could not save photo. Please retry.'
        );
      onChange(data.avatar_url ?? null);
      setBroken('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save photo.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-3">
        <div
          className="bg-muted flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-semibold"
          aria-hidden="true"
        >
          {contact.avatar_url && broken !== contact.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contact.avatar_url}
              alt=""
              className="size-full object-cover"
              onError={() => setBroken(contact.avatar_url!)}
            />
          ) : (
            initials
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-1">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-label={ar ? 'اختر صورة جهة الاتصال' : 'Choose contact photo'}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void save(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Camera className="size-4" aria-hidden />
              )}
              {ar
                ? contact.avatar_url
                  ? 'تغيير الصورة'
                  : 'إضافة صورة'
                : contact.avatar_url
                  ? 'Change photo'
                  : 'Add photo'}
            </Button>
            {contact.avatar_url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={
                  ar ? 'إزالة صورة جهة الاتصال' : 'Remove contact photo'
                }
                onClick={() => void save()}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <p className="text-muted-foreground text-xs">
          {ar
            ? 'تُقص الصورة بشكل مربع وتظهر في التطبيق وCRM.'
            : 'Cropped to a square. Shared with the app and CRM.'}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
