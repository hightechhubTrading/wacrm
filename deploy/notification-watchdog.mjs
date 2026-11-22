// Read-only infrastructure probe. Runs outside the CRM notification path; never logs credentials.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
try {
  if (!url || !key)
    throw new Error('Notification monitoring configuration unavailable');
  const result = await fetch(
    new URL('/rest/v1/rpc/notification_worker_status', url),
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!result.ok)
    throw new Error('Notification monitoring database probe failed');
  const state = await result.json();
  if (state.healthy !== true || state.failed > 0)
    throw new Error(
      'Notification worker heartbeat overdue or terminal delivery failures detected'
    );
  console.log('Notification worker healthy.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
