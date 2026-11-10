import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { exchange, verify } = vi.hoisted(() => ({
  exchange: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchange, verifyOtp: verify },
  }),
}));
import { GET } from './route';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
  exchange.mockReset().mockResolvedValue({ error: null });
  verify.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

async function callback(query: string) {
  return GET(new NextRequest(`http://localhost:3000/auth/callback${query}`));
}

describe('auth callback', () => {
  it('exchanges the PKCE code and redirects to the public reset form without leaking the code', async () => {
    const response = await callback('?code=one-time-code&next=/reset-password');
    expect(exchange).toHaveBeenCalledWith('one-time-code');
    expect(response.headers.get('location')).toBe(
      'https://crm.example.com/reset-password'
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('supports recovery token hashes from customized email templates', async () => {
    const response = await callback('?token_hash=one-time-hash&type=recovery');
    expect(verify).toHaveBeenCalledWith({
      token_hash: 'one-time-hash',
      type: 'recovery',
    });
    expect(exchange).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://crm.example.com/reset-password'
    );
  });

  it.each([
    '',
    '?error=access_denied&code=ignored',
    '?error_code=otp_expired',
    '?token_hash=hash&type=signup',
  ])('rejects incomplete or failed links: %s', async (query) => {
    const response = await callback(query);
    expect(exchange).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(
      'https://crm.example.com/reset-password?error=invalid_link'
    );
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/api/unrelated',
  ])('ignores unsafe or unrelated next destinations: %s', async (next) => {
    const response = await callback(
      `?code=valid&next=${encodeURIComponent(next)}`
    );
    expect(response.headers.get('location')).toBe(
      'https://crm.example.com/dashboard'
    );
  });

  it('shows a recoverable error for an expired code or a missing browser verifier', async () => {
    exchange.mockResolvedValue({ error: { message: 'invalid code verifier' } });
    const response = await callback('?code=expired&next=/reset-password');
    expect(response.headers.get('location')).toContain(
      '/reset-password?error=invalid_link'
    );
  });

  it('handles auth service failures without exposing token details', async () => {
    verify.mockRejectedValue(new Error('network error'));
    const response = await callback('?token_hash=secret&type=recovery');
    expect(response.headers.get('location')).toBe(
      'https://crm.example.com/reset-password?error=invalid_link'
    );
  });
});
