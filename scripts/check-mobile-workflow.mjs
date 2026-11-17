import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installMediaFixtures } from './check-mobile-media.mjs';
export async function installWorkflowFixtures(
  page,
  { realAuth = false, viewer = false } = {}
) {
  const fixture = await installMediaFixtures(page, { realAuth });
  const id = '12345678-1234-4234-8234-123456789abc';
  const row = {
    id,
    contact: {
      id: '22345678-1234-4234-8234-123456789abc',
      name: 'Synthetic Person',
      phone: '+0000000',
      avatar_url: null,
    },
    unread_count: 2,
    last_message_at: '2026-11-16T12:00:00+00:00',
    last_message_text: 'Synthetic preview',
  };
  let calls = 0,
    conflict = false,
    failRead = false,
    denyContact = false,
    company = 'Synthetic Company',
    blockHistory = false;
  let releaseHistory;
  let historyGate = Promise.resolve();
  const messages = Array.from({ length: 40 }, (_, i) => ({
    id: 'fixture-message-' + i,
    content_type: 'text',
    content_text:
      i === 39
        ? 'Latest synthetic message'
        : 'Synthetic conversation text. '.repeat(5),
    sender_type: i % 2 ? 'customer' : 'agent',
    status: 'read',
    created_at: new Date(Date.UTC(2026, 10, 16, 11, i)).toISOString(),
  }));
  await page.route('**/rest/v1/conversations*', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify([row]) })
  );
  await page.route('**/rest/v1/messages*', async (r) => {
    if (blockHistory) await historyGate;
    return r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([...messages].reverse()),
    });
  });
  if (viewer)
    await page.route('**/rest/v1/profiles*', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          account_id: 'fixture-account',
          account_role: 'viewer',
        }),
      })
    );
  await page.route('**/api/mobile/conversations/*/read', (r) => {
    assert.equal(r.request().method(), 'POST');
    assert.match(r.request().headers().authorization, /^Bearer /);
    calls++;
    const snapshot = r.request().postDataJSON();
    if (conflict) {
      conflict = false;
      row.last_message_at = '2026-11-16T12:01:00+00:00';
      row.unread_count = 3;
      return r.fulfill({ status: 409, body: '{}' });
    }
    if (failRead) return r.fulfill({ status: 503, body: '{}' });
    assert.equal(snapshot.unread_count, row.unread_count);
    assert.equal(snapshot.last_message_at, row.last_message_at);
    row.unread_count = 0;
    return r.fulfill({
      contentType: 'application/json',
      body: '{"read":true}',
    });
  });
  await page.route('**/api/mobile/conversations/*/contact', (r) => {
    assert.equal(r.request().method(), 'GET');
    assert.match(r.request().headers().authorization, /^Bearer /);
    return r.fulfill({
      status: denyContact ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        denyContact
          ? {}
          : {
              contact: {
                ...row.contact,
                company,
                email: 'synthetic@example.test',
              },
              tags: [{ id: 'tag-a', name: 'متابعة القياس' }],
              notes: [
                {
                  id: 'note-a',
                  note_text: 'ملاحظة تجريبية للقياس',
                  created_at: '2026-11-16T12:00:00Z',
                },
              ],
              notesLimit: 50,
            }
      ),
    });
  });
  return {
    row,
    calls: () => calls,
    setConflict: () => {
      conflict = true;
    },
    setFail: (v) => {
      failRead = v;
    },
    setDeny: (v) => {
      denyContact = v;
    },
    setCompany: (v) => {
      company = v;
    },
    blockHistory: () => {
      blockHistory = true;
      historyGate = new Promise((r) => (releaseHistory = r));
    },
    releaseHistory: () => {
      blockHistory = false;
      releaseHistory?.();
    },
    emit: () => fixture.realtime.emit('conversations'),
  };
}
export async function checkDetails(page, fixture) {
  await page
    .getByRole('button', { name: 'Contact details', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Contact details',
    exact: true,
  });
  await dialog.getByText('Synthetic Company', { exact: true }).waitFor();
  await dialog.getByText('متابعة القياس', { exact: true }).waitFor();
  await dialog.getByText('ملاحظة تجريبية للقياس', { exact: true }).waitFor();
  for (const width of [320, 390, 430]) {
    if (!(await page.evaluate(() => !!window.Capacitor?.isNativePlatform())))
      await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await dialog.evaluate((e) => e.scrollWidth > e.clientWidth),
      false
    );
  }
  await page.screenshot({ path: '/tmp/wacrm-mobile-ui/contact-details.png' });
  fixture.setCompany('Updated synthetic company');
  await dialog.getByRole('button', { name: 'Refresh contact details' }).click();
  await dialog
    .getByText('Updated synthetic company', { exact: true })
    .waitFor();
  fixture.setDeny(true);
  await dialog.getByRole('button', { name: 'Refresh contact details' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(
    await dialog
      .getByText('Updated synthetic company', { exact: true })
      .count(),
    0
  );
  fixture.setDeny(false);
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await dialog
    .getByText('Updated synthetic company', { exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page
    .getByRole('heading', { name: 'Synthetic Person', exact: true })
    .waitFor();
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const b = await chromium.launch({ channel: 'chrome' });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const f = await installWorkflowFixtures(p);
    f.blockHistory();
    await p.goto('http://127.0.0.1:4175');
    await p.getByLabel('Email', { exact: true }).fill('fixture@example.test');
    await p.getByLabel('Password', { exact: true }).fill('fixture-password');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.locator('button.conversation').click();
    await p.waitForTimeout(650);
    assert.equal(f.calls(), 0, 'Unloaded history must stay unread');
    f.releaseHistory();
    await p.getByText('Latest synthetic message', { exact: true }).waitFor();
    await p.waitForFunction(() => !document.querySelector('[role="status"]'));
    await p.waitForTimeout(750);
    assert.equal(f.calls(), 1);
    assert.equal(f.row.unread_count, 0);
    await checkDetails(p, f);
    // New messages while reading old history stay unread until the latest are visible.
    await p.locator('.transcript').evaluate((el) => (el.scrollTop = 0));
    await p.waitForTimeout(100);
    f.row.unread_count = 1;
    f.row.last_message_at = '2026-11-16T12:02:00+00:00';
    const before = f.calls();
    f.emit();
    await p.waitForTimeout(1100);
    assert.equal(
      f.calls(),
      before,
      'Reading older history must not clear new unread messages'
    );
    await p
      .locator('.transcript')
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await p.waitForTimeout(850);
    assert.equal(f.row.unread_count, 0);
    // A changed snapshot is refetched, then safely retried against the new version.
    f.setConflict();
    f.row.unread_count = 2;
    f.row.last_message_at = '2026-11-16T12:03:00+00:00';
    f.emit();
    await p.waitForTimeout(1900);
    assert.equal(f.row.unread_count, 0);
    const foregroundCalls = f.calls();
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    f.row.unread_count = 1;
    f.row.last_message_at = '2026-11-16T12:03:30+00:00';
    f.emit();
    await p.waitForTimeout(850);
    assert.equal(
      f.calls(),
      foregroundCalls,
      'Background conversations must stay unread'
    );
    await p.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await p.waitForTimeout(1400);
    assert.equal(
      f.row.unread_count,
      0,
      'Resume refetches before acknowledging read'
    );
    f.setFail(true);
    f.row.unread_count = 1;
    f.row.last_message_at = '2026-11-16T12:04:00+00:00';
    f.emit();
    await p.getByText('Read status wasn’t saved.', { exact: false }).waitFor();
    assert.equal(f.row.unread_count, 1);
    f.setFail(false);
    await p
      .locator('.read-status')
      .getByRole('button', { name: 'Retry' })
      .click();
    await p.waitForTimeout(850);
    assert.equal(f.row.unread_count, 0);
    assert.deepEqual(errors, []);
    await p.close();
    const viewer = await b.newPage();
    const vf = await installWorkflowFixtures(viewer, { viewer: true });
    await viewer.goto('http://127.0.0.1:4175');
    await viewer
      .getByLabel('Email', { exact: true })
      .fill('fixture@example.test');
    await viewer
      .getByLabel('Password', { exact: true })
      .fill('fixture-password');
    await viewer.getByRole('button', { name: 'Sign in', exact: true }).click();
    await viewer.locator('button.conversation').click();
    await viewer
      .getByText('Latest synthetic message', { exact: true })
      .waitFor();
    await viewer.waitForTimeout(850);
    assert.equal(vf.calls(), 0, 'Viewers cannot mutate shared unread state');
    await viewer
      .getByRole('button', { name: 'Contact details', exact: true })
      .click();
    await viewer.getByText('Synthetic Company', { exact: true }).waitFor();
    console.log(
      'PASS mobile workflow: loaded/latest/foreground-only read, resume recovery, unread synchronization, viewer guard, conflict recovery, failed-write retry, contact details/Arabic/refresh/access removal, responsive dialog and Escape. Synthetic data only.'
    );
  } finally {
    await b.close();
  }
}
