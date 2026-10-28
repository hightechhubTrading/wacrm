import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeploymentDatabase } from './check-database.mjs';
const options = {
  url: 'https://database.example.invalid',
  serviceRoleKey: 'dummy-server-key',
};
test('accepts the required columns and denied identity-free conversion probe', async () => {
  const requests = [];
  await checkDeploymentDatabase({
    ...options,
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return new Response(
        JSON.stringify(requests.length === 6 ? { code: '42501' } : []),
        { status: requests.length === 6 ? 403 : 200 }
      );
    },
  });
  assert.equal(requests.length, 6);
  for (const r of requests.slice(0, 5))
    assert.equal(r.url.searchParams.get('limit'), '0');
  assert.equal(JSON.parse(requests[5].init.body).p_conversation_id, null);
});
test('rejects missing catalog columns before probing conversions', async () => {
  await assert.rejects(
    checkDeploymentDatabase({
      ...options,
      fetchImpl: async () => new Response('{}', { status: 400 }),
    }),
    /migration 078/
  );
});
test('rejects missing conversion migration before promotion', async () => {
  let count = 0;
  await assert.rejects(
    checkDeploymentDatabase({
      ...options,
      fetchImpl: async () =>
        ++count < 6
          ? new Response('[]')
          : new Response('{"code":"PGRST202"}', { status: 404 }),
    }),
    /migration 076/
  );
});
test('rejects unexpectedly authorized probes or malformed provider responses', async () => {
  let count = 0;
  await assert.rejects(
    checkDeploymentDatabase({
      ...options,
      fetchImpl: async () =>
        ++count < 6 ? new Response('[]') : new Response('not-json'),
    }),
    /migration 076/
  );
});
