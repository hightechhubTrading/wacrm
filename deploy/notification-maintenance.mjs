// Database-only fallback drain for rolling updates. No provider or customer sends.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
try {
  if (!url || !key)
    throw new Error('Notification maintenance configuration unavailable');
  const response = await fetch(
    new URL('/rest/v1/rpc/maintain_notifications', url),
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!response.ok)
    throw new Error('Notification maintenance database request failed');
  console.log('Notification maintenance completed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
