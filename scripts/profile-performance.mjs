/** Build an isolated production Next app against a local synthetic account.
 * Real workspace components, routing, auth/session lifecycle and API handlers;
 * local synthetic Supabase/Realtime transport. No production writes. */
import {
  mkdtemp,
  cp,
  symlink,
  readFile,
  writeFile,
  mkdir,
  stat,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import {
  startSupabaseFixture,
  fixtureEncryptionKey,
} from './performance/supabase-fixture.mjs';
const runFile = promisify(execFile),
  project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const variant = process.env.PERFORMANCE_VARIANT || 'current';
if (!['current', 'baseline'].includes(variant))
  throw new Error('Expected current or baseline');
const directory =
  process.env.PERFORMANCE_APP_DIR ||
  (await mkdtemp(join(tmpdir(), `wacrm-production-${variant}-`)));
const output = resolve(
  process.env.PERFORMANCE_REPORT || `docs/performance-browser-${variant}.json`
);
const fixtureLatency = Number(process.env.PERFORMANCE_FIXTURE_LATENCY_MS || 25);
const priorStamp = process.env.PERFORMANCE_APP_DIR
  ? JSON.parse(
      await readFile(join(directory, '.performance-fixture.json'), 'utf8')
    )
  : null;
const backend = await startSupabaseFixture({
  latency: fixtureLatency,
  port: priorStamp ? Number(new URL(priorStamp.backend).port) : 0,
});
let child, browser;
let serverLog = '',
  samplesTimer;
const resources = [];
const report = {
  variant,
  completed: false,
  measuredAt: new Date().toISOString(),
  environment: {
    backend:
      'Local synthetic Supabase and Realtime fixture; SQL/RLS verified separately',
    backendLatencyMs: fixtureLatency,
    bundler: 'webpack (matches Dockerfile)',
    fixture: {
      conversations: 1500,
      deals: 1500,
      quotations: 1500,
      firstThreadMessages: 600,
    },
    browser: 'Chromium/Chrome, production Next build',
    cpuThrottle: 4,
    network: {
      latencyMs: 40,
      downloadBytesPerSecond: 5 * 1024 * 1024,
      uploadBytesPerSecond: 1024 * 1024,
    },
    coldDefinition:
      'Full document navigation after clearing the browser HTTP cache; warm means Next client navigation.',
    timezone: 'Europe/Berlin',
    note: 'Synthetic account and transport; these are not production-user latency measurements.',
  },
  routes: [],
  checks: [],
  artifacts: directory,
};
async function execute(binary, args, options = {}) {
  await new Promise((yes, no) => {
    const process = spawn(binary, args, {
      cwd: directory,
      env: options.env || env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    process.stdout.on('data', (data) => (output += data));
    process.stderr.on('data', (data) => (output += data));
    process.on('error', no);
    process.on('exit', (code) =>
      code === 0
        ? yes(output)
        : no(new Error(`${binary} failed (${code}): ${output.slice(-5000)}`))
    );
  });
}
const port = await new Promise((yes) => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => yes(port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: backend.origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
  ENCRYPTION_KEY: fixtureEncryptionKey,
  META_APP_SECRET: 'fixture-only',
  NEXT_PUBLIC_SITE_URL: origin,
  AI_WORK_POLL_ENABLED: 'false',
  META_CAPI_ENABLED: 'false',
  PERFORMANCE_LOGS: '1',
  NEXT_TELEMETRY_DISABLED: '1',
};
try {
  if (!process.env.PERFORMANCE_APP_DIR) {
    console.log(`Preparing ${variant} production workspace: ${directory}`);
    const archive = join(directory, 'source.tar');
    await runFile(
      'git',
      ['archive', '--format=tar', '--output', archive, 'HEAD'],
      { cwd: project }
    );
    await runFile('tar', ['-xf', archive, '-C', directory]);
    if (variant === 'current') {
      for (const name of ['src', 'messages'])
        await cp(join(project, name), join(directory, name), {
          recursive: true,
          force: true,
        });
      for (const name of [
        'next.config.ts',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'postcss.config.mjs',
      ])
        await cp(join(project, name), join(directory, name));
    } else {
      // Passive diagnostics are identical in both builds; authorization is unchanged.
      for (const name of [
        'src/lib/performance.ts',
        'src/lib/supabase/server.ts',
        'src/middleware.ts',
      ])
        await cp(join(project, name), join(directory, name));
    }
    await symlink(
      join(project, 'node_modules'),
      join(directory, 'node_modules')
    );
    if (variant === 'baseline') {
      const file = join(directory, 'src/lib/auth/account.ts');
      let code = await readFile(file, 'utf8');
      code =
        "import {measureServerOperation} from '@/lib/performance';\n" + code;
      code = code.replace(
        'export async function getCurrentAccount(): Promise<AccountContext> {',
        "export function getCurrentAccount(): Promise<AccountContext> {return measureServerOperation('account.resolve',resolveCurrentAccount);}\nasync function resolveCurrentAccount(): Promise<AccountContext> {"
      );
      await writeFile(file, code);
    }
    await writeFile(
      join(directory, '.performance-fixture.json'),
      JSON.stringify({ backend: backend.origin, variant })
    );
    console.log('Building production app…');
    await execute(process.execPath, [
      join(project, 'node_modules/next/dist/bin/next'),
      'build',
      '--webpack',
    ]);
  } else {
    const stamp = JSON.parse(
      await readFile(join(directory, '.performance-fixture.json'), 'utf8')
    );
    await stat(join(directory, '.next/BUILD_ID'));
    // Public backend URL is compiled into JS; reuse the original port on reruns.
    if (stamp.backend !== backend.origin)
      throw new Error(
        'A reused build must use its original fixture backend port. Rebuild instead.'
      );
  }
  if (process.env.PERFORMANCE_BUILD_ONLY === '1') {
    console.log(`Prepared production build: ${directory}`);
    await backend.close();
    process.exit(0);
  }
  const hash = createHash('sha256');
  async function hashTree(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    )) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await hashTree(target);
      else if (entry.isFile()) {
        hash.update(target.slice(directory.length));
        hash.update(await readFile(target));
      }
    }
  }
  await hashTree(join(directory, 'src'));
  await hashTree(join(directory, 'messages'));
  report.sourceSha256 = hash.digest('hex');
  console.log('Starting production app…');
  child = spawn(
    process.execPath,
    [
      join(project, 'node_modules/next/dist/bin/next'),
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      String(port),
    ],
    { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stdout.on('data', (data) => (serverLog += data));
  child.stderr.on('data', (data) => (serverLog += data));
  for (let n = 0; n < 120; n++) {
    if (child.exitCode !== null) throw new Error(serverLog.slice(-3000));
    try {
      if ((await fetch(origin + '/login')).ok) break;
    } catch {}
    if (n === 119) throw new Error('Production server did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  samplesTimer = setInterval(async () => {
    try {
      const { stdout } = await runFile('ps', [
        '-o',
        'rss=,%cpu=',
        '-p',
        String(child.pid),
      ]);
      const [rss, cpu] = stdout.trim().split(/\s+/).map(Number);
      resources.push({ at: Date.now(), rssBytes: rss * 1024, cpuPercent: cpu });
    } catch {}
  }, 1000);
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  });
  const session = backend.session(),
    cookie =
      'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const newContext = async (viewport = { width: 1440, height: 1000 }) => {
    const context = await browser.newContext({
      viewport,
      timezoneId: 'Europe/Berlin',
    });
    await context.addCookies([
      { name: 'sb-127-auth-token', value: cookie, url: origin },
      { name: 'wacrm.locale', value: 'en', url: origin },
    ]);
    await context.route('**/api/dashboard/weather*', (route) =>
      route.fulfill({ status: 503, json: { error: 'Fixture weather omitted' } })
    );
    await context.route('**/api/whatsapp/config', (route) =>
      route.fulfill({
        json: {
          connected: true,
          phone_number_id: 'fixture-number',
          config: { phone_number_id: 'fixture-number' },
          health: { ok: true },
        },
      })
    );
    // Guard all other external requests: the fixture must never contact customers.
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (
        host === '127.0.0.1' ||
        host === 'localhost' ||
        route.request().url().startsWith('blob:')
      )
        return route.fallback();
      return route.abort();
    });
    await context.addInitScript(() => {
      window.__performanceLongTasks = [];
      window.__performanceEvents = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (entry.interactionId)
            window.__performanceEvents.push({
              start: entry.startTime,
              duration: entry.duration,
              interactionId: entry.interactionId,
              name: entry.name,
            });
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.__performanceLongTasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
      }).observe({ type: 'longtask', buffered: true });
    });
    return context;
  };
  const context = await newContext(),
    page = await context.newPage(),
    cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 40,
    downloadThroughput: 5 * 1024 * 1024,
    uploadThroughput: 1024 * 1024,
  });
  const errors = [];
  const appRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && !url.pathname.startsWith('/_next/'))
      appRequests.push({
        path: url.pathname,
        prefetch: request.headers()['next-router-prefetch'] === '1',
        type: request.resourceType(),
      });
  });
  report.browserErrors = errors;
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.log('Browser error:', error.message);
  });
  const readiness = {
    inbox: '[data-conversation-viewport] button',
    dashboard: '.crm-dashboard-metrics .crm-metric',
    pipelines: '.crm-smart-deal-main',
    quotations: 'tbody tr',
    settings: '.crm-settings-content h2',
  };
  async function recordRoute(route, navigation = 'cold') {
    if (navigation === 'cold') await cdp.send('Network.clearBrowserCache');
    const frontendStart = appRequests.length;
    await page.evaluate(() => performance.clearResourceTimings());
    const requestStart = backend.requests.length,
      started = performance.now();
    if (navigation === 'cold') await page.goto(origin + '/' + route);
    else await page.locator(`a[href="/${route}"]`).first().click();
    await page.locator(readiness[route]).first().waitFor({ timeout: 30000 });
    const usefulMs = performance.now() - started;
    await page.waitForTimeout(100);
    const browser = await page.evaluate(() => ({
      timeOrigin: performance.timeOrigin,
      navigation: performance.getEntriesByType('navigation').map((entry) => ({
        ttfbMs: entry.responseStart - entry.requestStart,
        bytes: entry.transferSize,
        encoded: entry.encodedBodySize,
      })),
      longTasks: window.__performanceLongTasks,
      interactions: window.__performanceEvents,
      resources: performance
        .getEntriesByType('resource')
        .filter(
          (e) =>
            e.name.includes('/_next/') ||
            e.name.includes('/rest/v1/') ||
            e.name.includes('/api/') ||
            e.name.includes('_rsc=')
        )
        .map((e) => ({
          bytes: e.transferSize,
          encoded: e.encodedBodySize,
          duration: e.duration,
          type: e.initiatorType,
        })),
      heap: performance.memory?.usedJSHeapSize,
    }));
    const requests = backend.requests.slice(requestStart);
    report.routes.push({
      route,
      navigation,
      usefulMs,
      backendRequests: requests.length,
      frontend: appRequests.slice(frontendStart),
      backendBytes: requests.reduce((n, r) => n + (r.bytes || 0), 0),
      browser,
    });
    console.log(
      `${route} ${navigation}: ${Math.round(usefulMs)} ms, ${requests.length} backend requests`
    );
  }
  for (const route of Object.keys(readiness)) await recordRoute(route);
  for (const route of [
    'inbox',
    'dashboard',
    'pipelines',
    'quotations',
    'settings',
    'inbox',
  ])
    await recordRoute(route, 'warm');
  for (let repeat = 0; repeat < 3; repeat++)
    for (const route of Object.keys(readiness))
      await recordRoute(route, 'warm');
  // Full workspace: deep link beyond the first list page, cached switching,
  // reconnect history, read receipts, old-message paging and typing under events.
  const first = backend.tables.conversations[0],
    outside = backend.tables.conversations[1499];
  if (variant === 'current') {
    await page.goto(`${origin}/inbox?c=${outside.id}`);
    await page
      .getByText('Fixture transcript 1500 message 1', { exact: true })
      .waitFor();
    report.checks.push('deep link outside first conversation page');
  } else
    report.checks.push(
      'Baseline limitation: unpaginated inbox hits fixture API cap before conversation 1500'
    );
  await page.goto(`${origin}/inbox?c=${first.id}`);
  await page
    .getByText('Fixture transcript 1 message 600', { exact: true })
    .waitFor();
  await page
    .locator('[data-conversation-viewport] button')
    .filter({ hasText: 'Fixture Customer 21' })
    .first()
    .click();
  await page
    .getByText('Fixture transcript 21 message 1', { exact: true })
    .waitFor();
  const warmStart = performance.now();
  await page
    .locator('[data-conversation-viewport] button')
    .filter({ hasText: 'Fixture Customer 1' })
    .first()
    .click();
  await page
    .getByText('Fixture transcript 1 message 600', { exact: true })
    .waitFor();
  report.warmChatMs = performance.now() - warmStart;
  report.checks.push('cached chat switching');
  await page
    .getByRole('button', { name: 'Hide contact panel', exact: true })
    .click();
  assert.equal(await page.locator('.crm-details-pane').count(), 0);
  await page.reload();
  await page
    .getByText('Fixture transcript 1 message 600', { exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Show contact panel', exact: true })
    .first()
    .click();
  await page.locator('.crm-details-pane').waitFor();
  report.checks.push(
    'contact-panel preference persists without hydration mismatch'
  );

  const composer = page.locator('textarea').first();
  await composer.fill('Synthetic unsent draft');
  const burstStart = performance.now();
  for (let n = 0; n < 8; n++) {
    const message = {
      ...backend.tables.messages.find((m) => m.conversation_id === first.id),
      id: `f0000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
      content_text: `Live fixture burst ${n}`,
      sender_type: 'customer',
      created_at: isoNow(n),
    };
    backend.tables.messages.push(message);
    backend.emit('messages', 'INSERT', message);
  }
  await composer.fill('Synthetic unsent draft after burst');
  await page
    .locator('.crm-message-column')
    .getByText('Live fixture burst 7', { exact: true })
    .waitFor();
  report.typingDuringBurstMs = performance.now() - burstStart;
  report.checks.push('typing and realtime burst');
  const missed = {
    ...backend.tables.messages.find(
      (message) => message.conversation_id === first.id
    ),
    id: 'f0000000-0000-0000-0000-000000000099',
    sender_type: 'customer',
    content_text: 'Fixture reconnect catch-up',
    created_at: isoNow(20),
  };
  backend.tables.messages.push(missed);
  backend.disconnectRealtime();
  await page
    .locator('.crm-message-column')
    .getByText('Fixture reconnect catch-up', { exact: true })
    .waitFor();
  report.checks.push('missed-message recovery after real SDK reconnect');

  const historyStart = performance.now();
  for (let n = 0; n < 10; n++) {
    const count = await page.locator('[id^="message-"]').count();
    await page
      .getByRole('button', { name: 'Load older messages', exact: true })
      .click();
    await page.waitForFunction(
      (count) => document.querySelectorAll('[id^="message-"]').length > count,
      count
    );
  }
  const historyCount = await page.locator('[id^="message-"]').count();
  const frameIntervals = await page
    .locator('.crm-message-scroll')
    .evaluate(async (element) => {
      const times = [];
      let last = performance.now();
      for (let n = 0; n < 30; n++) {
        element.scrollTop =
          (element.scrollHeight - element.clientHeight) *
          (0.05 + (0.9 * (n % 10)) / 9);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        times.push(now - last);
        last = now;
      }
      return times;
    });
  report.longThread = {
    loadedMessages: historyCount,
    loadHistoryMs: performance.now() - historyStart,
    scrollFrameIntervalsMs: frameIntervals,
  };
  report.checks.push('550+ loaded messages and scroll frame sampling');
  await page.evaluate(() => {
    window.__fixturePeers = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => new MediaStream() },
    });
    window.RTCPeerConnection = class extends EventTarget {
      constructor() {
        super();
        this.iceGatheringState = 'complete';
        this.connectionState = 'new';
        this.signalingState = 'stable';
        window.__fixturePeers.push(this);
      }
      getTransceivers() {
        return [];
      }
      addTrack() {}
      async createOffer() {
        return { type: 'offer', sdp: 'fixture-offer' };
      }
      async createAnswer() {
        return { type: 'answer', sdp: 'fixture-answer' };
      }
      async setLocalDescription(value) {
        this.localDescription = value;
        this.signalingState =
          value.type === 'offer' ? 'have-local-offer' : 'stable';
      }
      async setRemoteDescription(value) {
        this.remoteDescription = value;
        this.signalingState =
          value.type === 'offer' ? 'have-remote-offer' : 'stable';
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
        this.dispatchEvent(new Event('connectionstatechange'));
      }
      close() {
        this.closed = true;
        this.connectionState = 'closed';
      }
    };
  });
  const callingPattern = '**/api/whatsapp/calls**';
  const callingRoute = async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path.endsWith('/settings')) return route.fallback();
    if (path.endsWith('/permissions'))
      return route.fulfill({
        json: {
          permissions: {
            permission: { status: 'permanent' },
            actions: [{ action_name: 'start_call', can_perform_action: true }],
          },
        },
      });
    if (path.endsWith('/audio-config'))
      return route.fulfill({ json: { iceServers: [] } });
    if (request.method() === 'GET')
      return route.fulfill({
        json: {
          calls: backend.tables.whatsapp_calls.filter((call) =>
            ['ringing', 'connecting', 'active'].includes(call.state)
          ),
        },
      });
    const body = request.postDataJSON();
    let call;
    if (path === '/api/whatsapp/calls') {
      call = {
        id: 'c0000000-0000-0000-0000-000000000100',
        account_id: backend.ids.account,
        conversation_id: first.id,
        direction: 'outbound',
        state: 'active',
        agent_user_id: backend.ids.user,
        client_id: body.client_id,
        remote_sdp_type: 'answer',
        remote_sdp: 'fixture-remote-answer',
        created_at: isoNow(),
        answered_at: isoNow(),
        customer_name: 'Synthetic outgoing call',
      };
      backend.tables.whatsapp_calls.push(call);
    } else {
      call = backend.tables.whatsapp_calls.find(
        (call) => call.id === path.split('/').at(-1)
      );
      if (body.action === 'claim')
        Object.assign(call, {
          agent_user_id: backend.ids.user,
          client_id: body.client_id,
          state: 'connecting',
        });
      if (body.action === 'accept')
        Object.assign(call, { state: 'active', answered_at: isoNow() });
      if (['terminate', 'reject'].includes(body.action))
        Object.assign(call, { state: 'ended', ended_at: isoNow() });
    }
    return route.fulfill({ json: { call } });
  };
  await context.route(callingPattern, callingRoute);
  await page
    .getByRole('button', { name: 'WhatsApp calls', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Call customer', exact: true })
    .click();
  await page.getByText('On call', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.locator('.crm-call-panel').waitFor({ state: 'hidden' });
  const incoming = {
    id: 'c0000000-0000-0000-0000-000000000101',
    account_id: backend.ids.account,
    conversation_id: first.id,
    direction: 'inbound',
    state: 'ringing',
    agent_user_id: null,
    remote_sdp_type: 'offer',
    remote_sdp: 'fixture-incoming-offer',
    created_at: isoNow(),
    customer_name: 'Synthetic incoming call',
  };
  backend.tables.whatsapp_calls.push(incoming);
  await page.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
  );
  backend.emit('whatsapp_calls', 'INSERT', incoming);
  await page.getByRole('button', { name: 'Answer', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await page.getByText('On call', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Unmute', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  );
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.locator('.crm-call-panel').waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () => window.__fixturePeers.filter((peer) => peer.closed).length
    ),
    2
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await context.unroute(callingPattern, callingRoute);
  report.checks.push(
    'outgoing/incoming synthetic SDP, hidden-tab ringing, mute and peer cleanup (no real audio or calls)'
  );

  report.workspaceProfile = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    events: window.__performanceEvents,
    longTasks: window.__performanceLongTasks,
    heap: performance.memory?.usedJSHeapSize,
    messages: document.querySelectorAll('[id^=\"message-\"]').length,
  }));
  // All settings panels must mount through actual Next dynamic boundaries.
  const sections = [
    'overview',
    'profile',
    'security',
    'appearance',
    'whatsapp',
    'templates',
    'quick-replies',
    'fields',
    'deals',
    'products',
    'members',
    'api',
    'quotation-product-codes',
  ];
  for (const section of sections) {
    await page.goto(`${origin}/settings?tab=${section}`);
    await page.locator('.crm-settings-content').waitFor();
    await page.waitForFunction(
      () =>
        !!document.querySelector('.crm-settings-content')?.textContent?.trim()
    );
    assert.ok(
      (await page.locator('.crm-settings-content').innerText()).trim(),
      `Blank settings panel: ${section}`
    );
  }
  report.checks.push('all thirteen settings deep links');
  // Real Next client navigation must retain route-specific translations.
  await recordRoute('inbox', 'warm');
  await recordRoute('quotations', 'warm');
  await recordRoute('dashboard', 'warm');
  assert.ok(
    !errors.some((error) =>
      /MISSING_MESSAGE|INVALID_MESSAGE|locale/.test(error)
    ),
    errors.join('\n')
  );
  backend.tables.profiles[0].locale = 'ar';
  const mobile = await newContext({ width: 390, height: 844 });
  await mobile.addCookies([{ name: 'wacrm.locale', value: 'ar', url: origin }]);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(
    `${origin}/inbox?c=${variant === 'current' ? outside.id : first.id}`
  );
  await mobilePage
    .getByText(
      variant === 'current'
        ? 'Fixture transcript 1500 message 1'
        : 'Fixture transcript 1 message 600',
      { exact: true }
    )
    .waitFor();
  assert.equal(await mobilePage.locator('html').getAttribute('dir'), 'rtl');
  report.checks.push('mobile Arabic deep link');
  await mobile.close();
  backend.tables.profiles[0].locale = 'en';
  if (variant === 'current') {
    await page.goto(origin + '/dashboard');
    await page.locator(readiness.dashboard).first().waitFor();
    const unreadRow = backend.tables.conversations.find(
      (row) => row.unread_count === 0
    );
    const unreadCount = () =>
      backend.tables.conversations.filter((row) => row.unread_count > 0).length;
    const unreadBadge = () =>
      page
        .locator(`[aria-label="${unreadCount()} unread conversations"]`)
        .first();
    await unreadBadge().waitFor();
    unreadRow.unread_count = 3;
    backend.emit('conversations', 'UPDATE', unreadRow);
    await unreadBadge().waitFor();
    unreadRow.unread_count = 0;
    backend.emit('conversations', 'UPDATE', unreadRow);
    await unreadBadge().waitFor();
    report.checks.push(
      'sidebar unread snapshot and realtime unknown/known transitions'
    );
  }
  // Measure real wall-clock idle cadence. A short debug run is explicitly
  // distinguished from the required five-minute measurement in the report.
  await page.goto(origin + '/inbox');
  await page.locator(readiness.inbox).first().waitFor();
  await page.waitForTimeout(2000);
  const idleDuration = Number(process.env.PERFORMANCE_IDLE_MS ?? 300_000),
    idleStart = backend.requests.length,
    idleStarted = performance.now();
  console.log(`Measuring ${idleDuration / 1000} seconds of real idle cadence…`);
  for (let elapsed = 0; elapsed < idleDuration; elapsed += 30_000)
    await page.waitForTimeout(Math.min(30_000, idleDuration - elapsed));
  const idle = backend.requests.slice(idleStart);
  report.idle = {
    durationMs: performance.now() - idleStarted,
    meetsFiveMinuteRequirement: idleDuration >= 300_000,
    backendRequests: idle.length,
    callingReads: idle.filter((r) => r.path === '/rest/v1/whatsapp_calls')
      .length,
    settingsReads: idle.filter((r) => r.path === '/rest/v1/whatsapp_config')
      .length,
  };
  report.checks.push(
    idleDuration >= 300_000
      ? 'five-minute real idle cadence'
      : 'short debug idle only'
  );
  // Two independent authenticated tabs retain incoming-call listeners. Measure
  // the aggregate cadence rather than assuming the single-tab result scales.
  const second = await context.newPage();
  second.on('pageerror', (error) => errors.push(error.message));
  await second.goto(origin + '/dashboard');
  await second.locator(readiness.dashboard).first().waitFor();
  await page.bringToFront();
  await page.waitForTimeout(2000);
  const tabsStart = backend.requests.length,
    tabsStarted = performance.now();
  console.log('Measuring 60 seconds with two authenticated tabs…');
  await page.waitForTimeout(30000);
  await page.waitForTimeout(30000);
  const tabRequests = backend.requests.slice(tabsStart);
  report.multipleTabs = {
    tabs: 2,
    durationMs: performance.now() - tabsStarted,
    backendRequests: tabRequests.length,
    callingReads: tabRequests.filter(
      (r) => r.path === '/rest/v1/whatsapp_calls'
    ).length,
    settingsReads: tabRequests.filter(
      (r) => r.path === '/rest/v1/whatsapp_config'
    ).length,
  };
  report.checks.push(
    'two-tab real idle cadence with background listener retained'
  );
  await second.close();
  report.completed = true;
  report.browserErrors = errors;
  report.serverResources = resources;
  report.serverOperations = serverLog
    .split('\n')
    .filter((line) => line.startsWith('{"event":"crm-performance"'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  await writeFile(join(directory, 'server.log'), serverLog);
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Production workspace report: ${output}`);
  if (errors.length)
    throw new Error(`${errors.length} browser errors; inspect the report`);
} catch (error) {
  report.completed = false;
  report.failure = error.message;
  throw error;
} finally {
  report.serverResources = resources;
  report.serverOperations = serverLog
    .split('\n')
    .filter((line) => line.startsWith('{\"event\":\"crm-performance\"'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  clearInterval(samplesTimer);
  await browser?.close();
  child?.kill('SIGTERM');
  await backend.close();
  await writeFile(join(directory, 'server.log'), serverLog).catch(() => {});
}
function isoNow(offset = 0) {
  return new Date(Date.now() + offset).toISOString();
}
