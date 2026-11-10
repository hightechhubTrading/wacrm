# Password recovery

The forgot-password form requests a Supabase recovery email with a redirect to
`/auth/callback?next=/reset-password`. The callback exchanges the PKCE code for
a cookie-backed session, then redirects to `/reset-password`. That page verifies
the current user before showing the new-password form. Passwords must match and
have at least eight characters; Supabase applies any additional password policy.

The callback also accepts `token_hash` with `type=recovery` for custom Supabase
email templates. It only redirects to explicit app destinations and marks its
response `no-store` and `no-referrer`. Recovery tokens are never logged by the
handler. Expired, consumed or incomplete links show retry instructions.

For the standard PKCE email flow, request and open the link in the same browser.
Opening it in another browser or device loses the verifier cookie. Request a new
link if an earlier attempt consumed the old one. Signed-in users can also visit
the forgot-password page to retry recovery.

Production configuration checked on 10 November 2026:

- Site URL: `https://wacrm.srv1795091.hstgr.cloud`
- Redirect allow-list: `https://wacrm.srv1795091.hstgr.cloud/**`
- Recovery link expiry: 3600 seconds

These settings already match the app. No Supabase configuration change or
database migration is required. Deploy using the existing VPS updater in
`deploy/README.md`.

Verification covers callback success/failure and redirect restrictions,
middleware access with existing sessions, and a browser run against the local
Supabase fixture: verifier/session cookies, mismatch prevention, password update,
expired-link retry, and mobile layout. No real user's password or recovery email
is used by these checks.
