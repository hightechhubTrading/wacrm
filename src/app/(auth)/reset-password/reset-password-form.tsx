'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LockKeyhole } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function ResetPasswordForm({ validSession }: { validSession: boolean }) {
  const t = useTranslations('PasswordRecovery');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !validSession) return;
    setError(null);
    if (password.length < 8) {
      setError(t('tooShort'));
      return;
    }
    if (password !== confirmation) {
      setError(t('mismatch'));
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        setError(error.message);
      } else {
        setPassword('');
        setConfirmation('');
        setComplete(true);
      }
    } catch {
      setError(t('networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 text-primary mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            <LockKeyhole className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-foreground text-xl">
            {complete
              ? t('updated')
              : validSession
                ? t('title')
                : t('requestLink')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {complete
              ? t('successDescription')
              : validSession
                ? t('description')
                : t('invalidLink')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {complete ? (
            <a
              href="/dashboard"
              className="text-primary block text-center underline"
            >
              {t('continue')}
            </a>
          ) : !validSession ? (
            <Link
              href="/forgot-password"
              className="text-primary block text-center underline"
            >
              {t('requestLink')}
            </Link>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">{t('newPassword')}</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">{t('confirmPassword')}</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={saving}
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? t('updating') : t('submit')}
              </Button>
              <Link
                href="/forgot-password"
                className="text-muted-foreground text-center text-sm underline"
              >
                {t('requestLink')}
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
