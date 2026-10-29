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
        JSON.stringify(
          requests.length === 9
            ? { code: '42501' }
            : requests.length === 10
              ? { items: [], count: 0 }
              : []
        ),
        { status: requests.length === 9 ? 403 : 200 }
      );
    },
  });
  assert.equal(requests.length, 10);
  for (const r of requests.slice(0, 8))
    assert.equal(r.url.searchParams.get('limit'), '0');
  assert.equal(JSON.parse(requests[8].init.body).p_conversation_id, null);
  assert.equal(JSON.parse(requests[9].init.body).p_account, null);
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
        ++count < 9
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
        ++count < 9 ? new Response('[]') : new Response('not-json'),
    }),
    /migration 076/
  );
});

test('rejects missing structured guide columns before promotion', async () => {
  let requests = 0;
  await assert.rejects(
    checkDeploymentDatabase({
      ...options,
      fetchImpl: async () =>
        new Response('[]', { status: ++requests === 2 ? 400 : 200 }),
    }),
    /migration 079/
  );
  assert.equal(requests, 2);
});

test('rejects missing Sales Today migration before promotion', async () => {
  await assert.rejects(
    checkDeploymentDatabase({
      ...options,
      fetchImpl: async (url) => {
        if (new URL(url).pathname.endsWith('/record_conversation_conversion'))
          return new Response('{"code":"42501"}', { status: 403 });
        if (new URL(url).pathname.endsWith('/sales_today_replies'))
          return new Response('{"code":"PGRST202"}', { status: 404 });
        return new Response('[]');
      },
    }),
    /migration 082/
  );
});
