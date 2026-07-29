// ============================================================
// src/lib/http/base-url.ts
//
// Resolve the absolute base URL this deployment is reachable at, for
// the handful of endpoints that have to hand a user a link they'll
// paste somewhere else (account invite links, an agent's WAHA webhook
// URL). Those links are one-time reveals — a relative or wrong-host
// URL is unrecoverable for the user, so guessing badly is worse than
// most config bugs.
//
// Extracted verbatim from `/api/account/invitations/route.ts`, which
// grew this resolution chain first; the members PATCH route needs
// exactly the same thing for the WAHA webhook URL it mints, and a
// naive `process.env.NEXT_PUBLIC_SITE_URL ?? ""` there produced a
// *relative* webhook URL on any deploy that hadn't set the env var.
//
// Resolution order, first match wins:
//
//   1. `NEXT_PUBLIC_SITE_URL` — admin's explicit config. Trumps
//      everything; if you set this, that's where links point.
//   2. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by every
//      reverse proxy in front of the app: Hostinger Managed
//      Node.js, Vercel, Cloudflare, nginx. This is what makes
//      generated links Just Work in production without forcing the
//      operator to set an env var.
//   3. `Host` header + the protocol the request arrived on —
//      bare deployments without a proxy.
//   4. Last-resort marketing-site fallback. Only hit if the
//      request has no Host header at all, which is essentially
//      impossible from a real browser. Logs a warning so the
//      operator can spot the misconfig.
//
// Defense-in-depth: `ALLOWED_INVITE_HOSTS`
//
//   The request-header path (#2 and #3 above) trusts whatever
//   hostname the client (or proxy) puts in the header. On a
//   typical proxied deploy (Vercel / Hostinger / Cloudflare) the
//   proxy overwrites these so they're trustworthy. On a bare
//   deployment exposed to the public internet, an attacker could
//   POST directly with a crafted `Host: phishing.example` and
//   receive a generated URL pointing at their site.
//
//   When `ALLOWED_INVITE_HOSTS` is set (comma-separated hostnames),
//   we validate the derived host against the list. Anything not
//   on the list falls through to a placeholder domain with a
//   loud console.warn. Operators who care about this attack
//   surface should set this to their canonical hostnames; everyone
//   else gets today's permissive behavior.
//
// The pre-extraction invitations implementation hard-defaulted to
// `https://wacrm.tech` (the upstream template's docs/marketing site,
// an unrelated repo). Deploys that didn't set `NEXT_PUBLIC_SITE_URL`
// got invite links pointing at a stranger's real site, which 404s on
// `/join/<token>`. This resolution chain removes the foot-gun.
// ============================================================

function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true; // No allow-list → permissive (legacy behavior).
  return allowList.includes(hostname.toLowerCase());
}

/**
 * Absolute origin (no trailing slash) to build user-facing links under.
 *
 * `logLabel` only prefixes the fall-through warnings, so an operator
 * reading the logs can tell which endpoint tripped the misconfig.
 */
export function getBaseUrl(request: Request, logLabel: string): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const allowList = parseAllowedHosts();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host && isHostAllowed(host, allowList)) {
    // The protocol on `request.url` is whatever the framework saw —
    // reliable for bare deployments where no proxy is rewriting it.
    const reqProto = new URL(request.url).protocol.replace(":", "");
    return `${reqProto}://${host}`;
  }

  // We fall through here when EITHER no Host header was present at
  // all (essentially impossible from a real browser) OR an
  // ALLOWED_INVITE_HOSTS list was set and neither candidate matched
  // it. The warning is the operator's signal that someone is
  // probing the API with a spoofed Host header.
  if (allowList && (forwardedHost || host)) {
    console.warn(`[${logLabel}] rejected non-allow-listed host:`, {
      forwardedHost,
      host,
      allowList,
    });
  } else {
    console.warn(
      `[${logLabel}] could not derive base URL from request; falling back to marketing domain`,
    );
  }
  return "https://hightechhub.example.com";
}
