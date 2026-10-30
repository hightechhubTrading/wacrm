import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeploymentDatabase } from './check-database.mjs';
const options = {
  url: 'https://database.example.invalid',
  serviceRoleKey: 'dummy-server-key',
};
const emptyPerformanceResponse = (pathname) => {
  if (
    ['dashboard_metrics', 'dashboard_response_time', 'account_profile'].some(
      (name) => pathname.endsWith('/' + name)
    )
  )
    return null;
  if (pathname.endsWith('/dashboard_pipeline_summary'))
    return { stages: [], totalValue: 0 };
  if (
    ['inbox_list', 'pipeline_list'].some((name) =>
      pathname.endsWith('/' + name)
    )
  )
    return { items: [], total: 0 };
  return [];
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
              : emptyPerformanceResponse(new URL(url).pathname)
        ),
        { status: requests.length === 9 ? 403 : 200 }
      );
    },
  });
  assert.equal(requests.length, 17);
  for (const r of requests.slice(0, 8))
    assert.equal(r.url.searchParams.get('limit'), '0');
  assert.equal(JSON.parse(requests[8].init.body).p_conversation_id, null);
  assert.equal(JSON.parse(requests[9].init.body).p_account, null);
  assert.equal(JSON.parse(requests[14].init.body).p_account, null);
  assert.equal(JSON.parse(requests[15].init.body).p_pipeline, null);
  assert.deepEqual(JSON.parse(requests[16].init.body), {});
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

const performanceProbes = [
  ['dashboard_metrics', '083'],
  ['dashboard_message_series', '083'],
  ['dashboard_pipeline_summary', '083'],
  ['dashboard_response_time', '083'],
  ['inbox_list', '084'],
  ['pipeline_list', '085'],
  ['account_profile', '086'],
];
function validFetch(url) {
  const path = new URL(url).pathname;
  if (path.endsWith('/record_conversation_conversion'))
    return new Response('{"code":"42501"}', { status: 403 });
  if (path.endsWith('/sales_today_replies'))
    return new Response('{"count":0,"items":[]}');
  return new Response(JSON.stringify(emptyPerformanceResponse(path)));
}
for (const [name, migration] of performanceProbes) {
  test(`blocks promotion when ${name} is absent from the schema cache`, async () => {
    await assert.rejects(
      checkDeploymentDatabase({
        ...options,
        fetchImpl: async (url) =>
          new URL(url).pathname.endsWith('/' + name)
            ? new Response('{"code":"PGRST202"}', { status: 404 })
            : validFetch(url),
      }),
      new RegExp('migration ' + migration)
    );
  });
}
test('accepts deliberately denied service-role EXECUTE after resolving each signature', async () => {
  await checkDeploymentDatabase({
    ...options,
    fetchImpl: async (url) =>
      performanceProbes.some(([name]) =>
        new URL(url).pathname.endsWith('/' + name)
      )
        ? new Response('{"code":"42501"}', { status: 403 })
        : validFetch(url),
  });
});
test('rejects invalid JSON rather than treating it as an empty profile', async () => {
  await assert.rejects(
    checkDeploymentDatabase({
      ...options,
      fetchImpl: async (url) =>
        new URL(url).pathname.endsWith('/account_profile')
          ? new Response('not JSON')
          : validFetch(url),
    }),
    /migration 086/
  );
});
test('rejects nonempty null-scoped inbox responses and generic authorization errors', async () => {
  for (const failure of [
    new Response('{"items":[{"id":"unexpected"}],"total":1}'),
    new Response('{"code":"PGRST301"}', { status: 401 }),
  ])
    await assert.rejects(
      checkDeploymentDatabase({
        ...options,
        fetchImpl: async (url) =>
          new URL(url).pathname.endsWith('/inbox_list')
            ? failure
            : validFetch(url),
      }),
      /migration 084/
    );
});
