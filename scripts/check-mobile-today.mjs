import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { installWorkflowFixtures } from './check-mobile-workflow.mjs';
export async function checkToday(p, { realAuth = false } = {}) {
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const f = await installWorkflowFixtures(p, { realAuth });
  const conv = '32345678-1234-4234-8234-123456789abc',
    id = '42345678-1234-4234-8234-123456789abc';
  let tasks = [
    {
      id,
      kind: 'inspection',
      status: 'open',
      owner_id: null,
      due_at: '2026-11-01T06:00:00Z',
      updated_at: '2026-11-17T00:00:00+00:00',
      conversation_id: conv,
      conversation: { contact: { name: 'عميل تجريبي', phone: '+0000000' } },
    },
  ];
  let posts = 0,
    conflict = false,
    fail = false,
    moreCalls = 0;
  await p.route('**/api/mobile/today*', (r) => {
    const req = r.request(),
      u = new URL(req.url());
    if (req.method() === 'POST') {
      posts++;
      const body = req.postDataJSON();
      assert.equal(body.id, id);
      assert.equal(body.conversation_id, conv);
      assert.equal(body.expected_updated_at, tasks[0].updated_at);
      if (conflict) {
        tasks[0].updated_at = '2026-11-17T00:02:00+00:00';
        return r.fulfill({ status: 409, body: '{}' });
      }
      if (body.status === 'acknowledged') {
        tasks[0].owner_id = 'fixture-user';
        tasks[0].updated_at = '2026-11-17T00:01:00+00:00';
      } else if (body.status === 'completed') {
        assert(body.completion_evidence.length >= 10);
        tasks = [];
      } else if (body.status === 'deferred') {
        assert(Date.parse(body.due_at) > Date.now());
        assert.equal(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Qatar',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(body.due_at)),
          '09:00'
        );
        tasks = [];
      }
      return r.fulfill({
        contentType: 'application/json',
        body: '{"success":true}',
      });
    }
    if (fail) return r.fulfill({ status: 503, body: '{}' });
    if (u.searchParams.get('offset')) moreCalls++;
    return r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tasks: u.searchParams.get('offset')
          ? [{ ...tasks[0], id: '52345678-1234-4234-8234-123456789abc' }]
          : tasks,
        total: tasks.length ? 26 : 0,
        nextOffset: u.searchParams.get('offset') || !tasks.length ? null : 25,
        canEdit: true,
        timeZone: 'Asia/Qatar',
      }),
    });
  });
  // The selected task is outside the inbox's 100 recent rows. Only a separately
  // authorized exact conversation read can open it; never expand the inbox cap.
  await p.route('**/rest/v1/conversations*', (r) => {
    const u = new URL(r.request().url());
    const exact = u.searchParams.get('id');
    return r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        exact
          ? {
              id: conv,
              contact: {
                id: 'contact-a',
                name: 'عميل تجريبي',
                phone: '+0000000',
              },
              unread_count: 0,
              last_message_at: null,
              last_message_text: null,
            }
          : [f.row]
      ),
    });
  });
  if (realAuth) await p.reload();
  else {
    await p.goto('http://127.0.0.1:4175');
    await p.getByLabel('Email', { exact: true }).fill('fixture@example.test');
    await p.getByLabel('Password', { exact: true }).fill('fixture-password');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await p
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Today', exact: true })
    .click();
  await p
    .getByRole('heading', { name: 'Your follow-ups', exact: true })
    .waitFor();
  await p.getByRole('heading', { name: 'عميل تجريبي', exact: true }).waitFor();
  await p.getByText(/Overdue ·/).waitFor();
  for (const width of realAuth ? [] : [320, 390, 430]) {
    await p.setViewportSize({ width, height: 844 });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
  }
  await p.screenshot({ path: '/tmp/wacrm-mobile-ui/today-followups.png' });
  await p.getByRole('button', { name: 'Show more follow-ups' }).click();
  await p
    .getByRole('heading', { name: 'عميل تجريبي', exact: true })
    .nth(1)
    .waitFor();
  assert.equal(moreCalls, 1);
  await p
    .getByRole('button', { name: /Site inspection عميل تجريبي/ })
    .first()
    .click();
  await p.getByRole('heading', { name: 'عميل تجريبي', exact: true }).waitFor();
  await p.getByText('Latest synthetic message', { exact: true }).waitFor();
  await p.getByRole('button', { name: 'Back to inbox' }).click();
  await p
    .getByRole('heading', { name: 'Your follow-ups', exact: true })
    .waitFor();
  await p.getByRole('button', { name: 'Take task', exact: true }).click();
  await p.getByText('Follow-up assigned to you.', { exact: true }).waitFor();
  await p
    .getByRole('button', { name: 'Take task', exact: true })
    .waitFor({ state: 'detached' });
  await p.getByRole('button', { name: 'Complete', exact: true }).click();
  const dialog = p.getByRole('dialog', { name: 'Complete follow-up' });
  const save = dialog.getByRole('button', { name: 'Save completion' });
  assert(await save.isDisabled());
  await dialog
    .getByLabel('What was completed?')
    .fill('تمت مراجعة القياس مع العميل التجريبي.');
  conflict = true;
  await save.click();
  await p
    .getByText(
      'This task changed. Review the updated follow-up before trying again.',
      { exact: true }
    )
    .waitFor();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(tasks.length, 1);
  conflict = false;
  await p.getByRole('button', { name: 'Complete', exact: true }).click();
  assert.equal(
    await dialog.getByLabel('What was completed?').inputValue(),
    'تمت مراجعة القياس مع العميل التجريبي.'
  );
  await save.click();
  await p
    .getByRole('heading', { name: 'You’re up to date', exact: true })
    .waitFor();
  assert.equal(posts, 3);
  fail = true;
  await p.getByRole('button', { name: 'Refresh Today' }).click();
  await p.getByRole('alert').waitFor();
  fail = false;
  await p.evaluate(() => {
    const retry = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Retry'
    );
    retry?.click();
  });
  await p
    .getByRole('heading', { name: 'You’re up to date', exact: true })
    .waitFor();
  tasks = [
    {
      id,
      kind: 'inspection',
      status: 'acknowledged',
      owner_id: 'fixture-user',
      due_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: '2026-11-17T00:03:00+00:00',
      conversation_id: conv,
      conversation: { contact: { name: 'عميل تجريبي', phone: '+0000000' } },
    },
  ];
  await p.getByRole('button', { name: 'Refresh Today' }).click();
  await p.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await p
    .getByText('Moved to tomorrow at 09:00 Qatar time.', { exact: true })
    .waitFor();
  await p
    .getByRole('heading', { name: 'You’re up to date', exact: true })
    .waitFor();
  assert.equal(posts, 4);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Today: assigned/unclaimed due work, Arabic/overdue display, responsive layout, pagination, authorized chat outside the 100-row inbox, take task, tomorrow at 09:00 Qatar, completion evidence, stale-conflict retry, shared update and load recovery. Synthetic data only.'
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const b = await chromium.launch({ channel: 'chrome' });
  try {
    await checkToday(
      await b.newPage({ viewport: { width: 390, height: 844 } })
    );
  } finally {
    await b.close();
  }
}
