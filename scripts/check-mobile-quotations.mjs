import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installWorkflowFixtures } from './check-mobile-workflow.mjs';
import { fixturePdf } from './check-mobile-media.mjs';
export async function checkQuotations(
  page,
  { realAuth = false, onShare, pressBack } = {}
) {
  await installWorkflowFixtures(page, { realAuth });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = '12345678-1234-4234-8234-123456789abc',
    documentId = '22345678-1234-4234-8234-123456789abc',
    conversationId = '32345678-1234-4234-8234-123456789abc';
  let version = 3,
    state = 'ready',
    result = 'accepted',
    deny = false,
    published = true,
    legacy = false,
    posts = 0,
    pdfs = 0,
    more = 0;
  const quote = () => ({
    id,
    reference: 'HT-TEST-001',
    revision: 2,
    status: state === 'sent' ? 'sent' : 'draft',
    clientName: 'عميل تجريبي',
    clientPhone: '+0000000',
    clientCompany: 'Synthetic company',
    subject: 'Synthetic quotation',
    projectName: 'Synthetic project',
    currency: 'QAR',
    subtotal: 123.45,
    discountAmount: 1,
    total: 122.45,
    updatedAt: '2026-11-17T00:00:00Z',
    workspaceVersion: version,
    paymentTerms: 'Synthetic approved payment terms',
    deliveryTerms: 'Synthetic approved delivery terms',
    warrantyTerms: 'Synthetic approved warranty',
  });
  await page.route('**/api/mobile/quotations**', async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    assert.match(req.headers().authorization, /^Bearer /);
    if (u.pathname.endsWith('/send')) {
      assert.equal(req.method(), 'POST');
      const body = req.postDataJSON();
      assert.equal(body.confirmed, true);
      assert.equal(body.documentId, documentId);
      assert.equal(body.conversationId, conversationId);
      assert.equal(body.workspaceVersion, version);
      assert.equal(body.caption, 'Synthetic caption');
      posts++;
      if (result === 'unknown') {
        state = 'uncertain';
        return route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: '{"code":"sendUncertain","error":"Synthetic uncertain delivery"}',
        });
      }
      state = 'sent';
      return route.fulfill({
        contentType: 'application/json',
        body: '{"success":true,"message_id":"synthetic-message"}',
      });
    }
    if (u.pathname.endsWith('/pdf')) {
      pdfs++;
      if (Number(u.searchParams.get('version')) !== version)
        return route.fulfill({ status: 409, body: '{}' });
      return route.fulfill({
        contentType: 'application/pdf',
        body: fixturePdf(),
      });
    }
    if (u.pathname.endsWith('/' + id)) {
      if (deny) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          quotation: quote(),
          items: [
            {
              id: 'line-a',
              position: 0,
              itemType: 'line',
              description: 'Synthetic shutter',
              descriptionAr: 'وصف تجريبي',
              specification: 'Synthetic specification',
              qty: 2,
              unit: 'pieces',
              unitPrice: 61.225,
              lineTotal: 122.45,
            },
          ],
          itemsLimit: 500,
          document: published
            ? {
                id: legacy ? null : documentId,
                revision: 2,
                workspaceVersion: version,
                sendState: legacy ? 'legacy' : state,
                sentAt: state === 'sent' ? '2026-11-17T00:00:00Z' : null,
                messageId: state === 'sent' ? 'synthetic-message' : null,
              }
            : null,
          conversationId,
        }),
      });
    }
    assert.equal(req.method(), 'GET');
    if (u.searchParams.has('offset')) more++;
    const rows =
      u.searchParams.get('search') === 'missing'
        ? []
        : u.searchParams.has('offset')
          ? [
              {
                ...quote(),
                id: '42345678-1234-4234-8234-123456789abc',
                reference: 'HT-TEST-002',
              },
            ]
          : [quote()];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        quotations: rows,
        total: rows.length ? 26 : 0,
        nextOffset: u.searchParams.has('offset') || !rows.length ? null : 25,
      }),
    });
  });
  await page.route('**/rest/v1/conversations*', (route) => {
    const u = new URL(route.request().url());
    const row = {
      id: conversationId,
      contact: { name: 'عميل تجريبي', phone: '+0000000' },
      unread_count: 0,
      last_message_at: null,
      last_message_text: 'Synthetic quotation chat',
    };
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(u.searchParams.has('id') ? row : [row]),
    });
  });
  if (realAuth) await page.reload();
  else {
    await page.goto('http://127.0.0.1:4175');
    await page
      .getByLabel('Email', { exact: true })
      .fill('fixture@example.test');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Quotations', exact: true })
    .click();
  await page.getByRole('button', { name: /HT-TEST-001/ }).waitFor();
  for (const width of realAuth ? [] : [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    );
  }
  await page.getByRole('button', { name: 'Show more quotations' }).click();
  await page.getByRole('button', { name: /HT-TEST-002/ }).waitFor();
  assert.equal(more, 1);
  await page
    .getByRole('searchbox', { name: 'Search quotations' })
    .fill('missing');
  await page.getByRole('heading', { name: 'No matching quotations' }).waitFor();
  await page.getByRole('searchbox', { name: 'Search quotations' }).fill('');
  await page.getByRole('button', { name: /HT-TEST-001/ }).click();
  const modal = page.getByRole('dialog', {
    name: 'Quotation details',
    exact: true,
  });
  await modal
    .getByRole('heading', { name: 'عميل تجريبي', exact: true })
    .waitFor();
  await modal.getByText('122.45 QAR', { exact: true }).first().waitFor();
  await modal
    .getByText('Synthetic approved payment terms', { exact: true })
    .waitFor();
  assert.equal(posts, 0);
  await page.screenshot({ path: '/tmp/wacrm-mobile-ui/quotation-details.png' });
  await modal.getByRole('button', { name: 'View PDF', exact: true }).click();
  await modal.getByText('Page 1 of 2', { exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Next page"]').disabled
  );
  await modal.getByRole('button', { name: 'Next page', exact: true }).click();
  await modal.getByText('Page 2 of 2', { exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.pdf-text')?.textContent.includes('page 2')
  );
  if (realAuth && pressBack) await pressBack();
  else await page.keyboard.press('Escape');
  await modal
    .getByRole('heading', { name: 'عميل تجريبي', exact: true })
    .waitFor();
  if (realAuth) {
    await modal.getByRole('button', { name: 'Share PDF', exact: true }).click();
    await onShare?.();
    await modal
      .getByRole('heading', { name: 'عميل تجريبي', exact: true })
      .waitFor();
  } else {
    const download = page.waitForEvent('download');
    await modal
      .getByRole('button', { name: 'Download PDF', exact: true })
      .click();
    assert.equal((await download).suggestedFilename(), 'HT-TEST-001-rev-2.pdf');
    await modal
      .getByText(
        'PDF download started. It has not been sent to the customer.',
        { exact: true }
      )
      .waitFor();
  }
  assert.equal(
    posts,
    0,
    'Viewing/downloading/system sharing must never dispatch or change send status'
  );
  assert.equal(state, 'ready');
  await modal
    .getByRole('button', { name: 'Open customer chat', exact: true })
    .click();
  await page.getByText('Latest synthetic message', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Back to inbox', exact: true })
    .click();
  await page.getByRole('button', { name: /HT-TEST-001/ }).click();
  await modal
    .getByRole('heading', { name: 'عميل تجريبي', exact: true })
    .waitFor();

  await modal
    .getByRole('button', { name: 'Send on WhatsApp', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Send quotation on WhatsApp?',
  });
  await confirmation.getByText('+0000000', { exact: true }).waitFor();
  await confirmation
    .getByText('HT-TEST-001 · Revision 2', { exact: true })
    .waitFor();
  assert.equal(posts, 0);
  if(realAuth&&pressBack)await pressBack();else await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  assert.equal(posts, 0);
  await modal
    .getByRole('button', { name: 'Send on WhatsApp', exact: true })
    .click();
  await confirmation.getByLabel('Optional message').fill('Synthetic caption');
  await confirmation
    .getByRole('button', { name: 'Confirm and send', exact: true })
    .dblclick();
  await modal
    .getByText('PDF accepted by WhatsApp. Delivery is shown in the chat.', {
      exact: true,
    })
    .waitFor();
  assert.equal(posts, 1);
  await modal
    .getByRole('button', { name: 'Refresh quotation details' })
    .click();
  await modal
    .getByText(
      'This document has already been accepted for sending. Check the chat for delivery.',
      { exact: true }
    )
    .waitFor();
  assert.equal(
    await modal
      .getByRole('button', { name: 'Send on WhatsApp', exact: true })
      .count(),
    0
  );
  // An uncertain attempt stays locked through refresh until authoritative status resolves it.
  state = 'ready';
  result = 'unknown';
  await modal
    .getByRole('button', { name: 'Refresh quotation details' })
    .click();
  await modal
    .getByRole('button', { name: 'Send on WhatsApp', exact: true })
    .click();
  assert.equal(
    await confirmation.getByLabel('Optional message').inputValue(),
    'Synthetic caption'
  );
  await confirmation
    .getByRole('button', { name: 'Confirm and send', exact: true })
    .click();
  await modal.getByRole('alert').waitFor();
  assert.equal(
    await modal
      .getByRole('button', { name: 'Send on WhatsApp', exact: true })
      .count(),
    0
  );
  await modal
    .getByRole('button', { name: 'Refresh quotation details' })
    .click();
  await modal
    .getByText(
      'Sending has not been confirmed. Check the chat and refresh status before taking further action.',
      { exact: true }
    )
    .waitFor();
  assert.equal(posts, 2);
  // Revalidating the PDF on every share prevents using a previously viewed stale file.
  version = 4;
  await modal
    .getByRole('button', {
      name: realAuth ? 'Share PDF' : 'Download PDF',
      exact: true,
    })
    .click();
  await modal
    .getByText('Quotation changed. Refresh before viewing or sharing.', {
      exact: true,
    })
    .waitFor();
  assert.equal(posts, 2);
  assert(pdfs >= 3);
  legacy = true;
  await modal
    .getByRole('button', { name: 'Refresh quotation details' })
    .click();
  await modal
    .getByText(
      'Saved PDF available. Prepare a current document in the CRM to enable WhatsApp sending.',
      { exact: true }
    )
    .waitFor();
  assert.equal(
    await modal
      .getByRole('button', { name: 'Send on WhatsApp', exact: true })
      .count(),
    0
  );
  published = false;
  await modal
    .getByRole('button', { name: 'Refresh quotation details' })
    .click();
  await modal
    .getByText('Prepare the current PDF in the CRM to view or share it here.', {
      exact: true,
    })
    .waitFor();
  assert(
    await modal
      .getByRole('button', { name: 'View PDF', exact: true })
      .isDisabled()
  );
  deny = true;
  await modal
    .getByRole('button', { name: 'Refresh quotation details' })
    .click();
  await modal.getByRole('alert').waitFor();
  assert.equal(
    await modal
      .getByRole('heading', { name: 'عميل تجريبي', exact: true })
      .count(),
    0
  );
  await modal.getByRole('button', { name: 'Close quotation details' }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS quotations: scoped list/search/pagination, stored values/terms, Arabic/responsive detail, real 2-page PDF, revalidated share/download without sending, explicit recipient/PDF confirmation, one dispatch on double click, uncertain status lock/recovery, stale/legacy/missing PDF and access-removal handling. Synthetic data only.'
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const b = await chromium.launch({ channel: 'chrome' });
  try {
    await checkQuotations(
      await b.newPage({ viewport: { width: 390, height: 844 } })
    );
  } finally {
    await b.close();
  }
}
