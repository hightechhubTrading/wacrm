export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Every outbound call to Meta's Graph API was failing with a bare
    // "fetch failed" in production (Hostinger/Docker) even though curl/wget
    // from the same host worked fine. Root-caused live: the container's
    // IPv6 route is dead (ENETUNREACH), and Node's fetch() uses Happy
    // Eyeballs (RFC 8305) to race the IPv4 + IPv6 candidates from DNS --
    // that racing, combined with the dead IPv6 leg, was enough to make the
    // otherwise-healthy IPv4 connection to Meta time out too. A plain
    // single-candidate connect (no racing) worked every time in the same
    // environment. Disabling Happy Eyeballs process-wide reproduces that
    // working path for every outbound fetch, not just Meta's.
    const { setDefaultAutoSelectFamily } = await import('net')
    setDefaultAutoSelectFamily(false)
  }
}
