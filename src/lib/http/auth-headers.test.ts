import { describe, expect, it } from 'vitest';
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import nextConfig from '../../../next.config';

describe('production recovery response headers', () => {
  it.each([
    '/auth/callback?code=secret&next=/reset-password',
    '/auth/callback?error=access_denied',
    '/reset-password',
    '/reset-password?error=invalid_link',
    '/forgot-password',
  ])('prevents caching and referrer leakage at %s', async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://crm.example.com${path}`,
      nextConfig,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
