import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Set a new password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return <ResetPasswordForm validSession={!params.error && !error && !!user} />;
}
