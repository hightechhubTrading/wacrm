import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Keep destinations explicit: never redirect a recovery session to a URL
// supplied by the link. The configured origin also avoids Docker's internal host.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  const failed = () => redirect('/reset-password?error=invalid_link');

  if (params.has('error') || params.has('error_code')) return failed();
  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  if (!code && !(tokenHash && params.get('type') === 'recovery'))
    return failed();

  try {
    const supabase = await createClient();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: 'recovery',
        });
    if (error) return failed();
  } catch {
    // Never log recovery codes, tokens, or the incoming URL.
    return failed();
  }

  return redirect(
    tokenHash || params.get('next') === '/reset-password'
      ? '/reset-password'
      : '/dashboard'
  );
}
