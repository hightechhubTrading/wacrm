// Pins the resolution chain that was extracted out of
// /api/account/invitations/route.ts so both that route and the members
// PATCH route (WAHA webhook URL) share it. Every branch here must keep
// returning an ABSOLUTE origin — both callers embed a one-time-reveal
// secret in the URL, so a relative/blank base is unrecoverable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBaseUrl } from './base-url';

const saved = {
  site: process.env.NEXT_PUBLIC_SITE_URL,
  hosts: process.env.ALLOWED_INVITE_HOSTS,
};

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.ALLOWED_INVITE_HOSTS;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of [
    ['NEXT_PUBLIC_SITE_URL', saved.site],
    ['ALLOWED_INVITE_HOSTS', saved.hosts],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('getBaseUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL and strips trailing slashes', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com//';
    expect(getBaseUrl(req('http://internal/x'), 'test')).toBe(
      'https://app.example.com',
    );
  });

  it('falls back to x-forwarded-host + proto', () => {
    expect(
      getBaseUrl(
        req('http://internal/x', {
          'x-forwarded-host': 'crm.example.com',
          'x-forwarded-proto': 'https',
        }),
        'test',
      ),
    ).toBe('https://crm.example.com');
  });

  it('defaults the forwarded proto to https', () => {
    expect(
      getBaseUrl(req('http://internal/x', { 'x-forwarded-host': 'crm.example.com' }), 'test'),
    ).toBe('https://crm.example.com');
  });

  it('falls back to the Host header with the request protocol', () => {
    // `new Request(url)` does NOT synthesise a Host header — Next/undici
    // supplies it from the real wire request — so it's set explicitly.
    expect(
      getBaseUrl(req('http://bare.example.com/x', { host: 'bare.example.com' }), 'test'),
    ).toBe('http://bare.example.com');
  });

  it('falls through to the placeholder domain when there is no host at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getBaseUrl(req('http://internal/x'), 'test')).toBe(
      'https://hightechhub.example.com',
    );
    expect(warn).toHaveBeenCalled();
  });

  it('rejects a host outside ALLOWED_INVITE_HOSTS and warns with the caller label', () => {
    process.env.ALLOWED_INVITE_HOSTS = 'crm.example.com';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const base = getBaseUrl(
      req('http://phishing.example/x', { 'x-forwarded-host': 'phishing.example' }),
      'PATCH /api/account/members/[userId]',
    );

    expect(base).toBe('https://hightechhub.example.com');
    expect(warn).toHaveBeenCalledWith(
      '[PATCH /api/account/members/[userId]] rejected non-allow-listed host:',
      expect.objectContaining({ forwardedHost: 'phishing.example' }),
    );
  });

  it('accepts an allow-listed host case-insensitively', () => {
    process.env.ALLOWED_INVITE_HOSTS = 'CRM.example.com';
    expect(
      getBaseUrl(req('http://internal/x', { 'x-forwarded-host': 'crm.example.com' }), 'test'),
    ).toBe('https://crm.example.com');
  });

  it('always returns an absolute origin', () => {
    for (const r of [
      req('http://bare.example.com/x', { host: 'bare.example.com' }),
      req('http://internal/x', { 'x-forwarded-host': 'crm.example.com' }),
    ]) {
      expect(() => new URL(getBaseUrl(r, 'test'))).not.toThrow();
    }
  });
});
