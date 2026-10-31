/** Checks the real deal form and pipeline color picker with synthetic data. */
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = await realpath(await mkdtemp(join(tmpdir(), 'wacrm-ui-review-')));
let server, browser;
try {
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'));
  await writeFile(
    join(root, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.tsx"></script>'
  );
  await writeFile(
    join(root, 'auth.ts'),
    `export const useAuth=()=>({accountId:'fixture',user:{id:'user'},accountRole:'owner',canSendMessages:true,defaultCurrency:'QAR',profile:{id:'user'}});`
  );
  await writeFile(join(root, 'can.ts'), `export const useCan=()=>true;`);
  await writeFile(
    join(root, 'client.ts'),
    `const client={from(){const chain={then(yes,no){return Promise.resolve({data:[],error:null}).then(yes,no)}};for(const name of ['select','order','eq','in','limit','maybeSingle','single'])chain[name]=()=>chain;return chain}};export const createClient=()=>client;`
  );
  await writeFile(
    join(root, 'link.tsx'),
    `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`
  );
  await writeFile(
    join(root, 'main.tsx'),
    `
    import React from 'react';import {createRoot} from 'react-dom/client';import {NextIntlClientProvider} from 'next-intl';
    import {DealForm} from ${JSON.stringify(join(project, 'src/components/pipelines/deal-form.tsx'))};
    import {PipelineSettings} from ${JSON.stringify(join(project, 'src/components/pipelines/pipeline-settings.tsx'))};
    import {MetricCard} from ${JSON.stringify(join(project, 'src/components/dashboard/metric-card.tsx'))};
    import dashboardStyles from ${JSON.stringify(join(project, 'src/components/dashboard/dashboard-design.module.css'))};
    import {MessageSquare, UserPlus, DollarSign, CalendarDays} from 'lucide-react';
    import widgetStyles from ${JSON.stringify(join(project, 'src/components/dashboard/workday-widget.module.css'))};
    import en from ${JSON.stringify(join(project, 'messages/en.json'))};import ar from ${JSON.stringify(join(project, 'messages/ar.json'))};
    import ${JSON.stringify(join(project, 'src/app/globals.css'))};
    import ${JSON.stringify(join(project, 'src/app/workspace.css'))};
    import ${JSON.stringify(join(project, 'src/app/design-system.css'))};
    const params=new URLSearchParams(location.search),locale=params.get('locale')||'en';
    document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
    const stage={id:'stage-1',pipeline_id:'pipeline-1',name:locale==='ar'?'مرحلة أولى':'First stage',color:'#6366f1',position:0};
    const pipeline={id:'pipeline-1',name:'Sales',account_id:'fixture'};
    function DashboardProbe(){return <main className={'crm-main crm-dashboard '+widgetStyles.dashboard+' '+dashboardStyles.surface}><header className="crm-dashboard-welcome"><div><p className="crm-dashboard-eyebrow">{locale==='ar'?'مساحة العمل':'WORKSPACE'}</p><h1>{locale==='ar'?'صباح الخير، فريق المبيعات':'Good morning, sales team'}</h1><p className="crm-dashboard-subtitle">{locale==='ar'?'العمل الذي يحتاج إلى انتباهك اليوم':'The work that needs your attention today'}</p></div><span className="crm-dashboard-calendar">{locale==='ar'?'اليوم':'Today'}</span></header><section><div className="crm-dashboard-section-heading"><div><p>{locale==='ar'?'نظرة عامة':'OVERVIEW'}</p><h2>{locale==='ar'?'حركة العمل':'Sales pulse'}</h2></div></div><div className="crm-dashboard-metrics"><MetricCard href="/inbox" tone="sage" title={locale==='ar'?'المحادثات النشطة':'Active conversations'} value="24" icon={MessageSquare} delta={{sign:3,label:locale==='ar'?'٣ جديدة اليوم':'3 new today'}}/><MetricCard href="/contacts" tone="sky" title={locale==='ar'?'جهات اتصال جديدة':'New contacts'} value="8" icon={UserPlus} comparison={{current:8,previous:6,currentLabel:locale==='ar'?'اليوم':'Today',previousLabel:locale==='ar'?'أمس':'Yesterday'}}/><MetricCard href="/pipelines" tone="sand" title={locale==='ar'?'قيمة الصفقات المفتوحة':'Open deal value'} value="QAR 142,800" icon={DollarSign} subtitle={locale==='ar'?'١٢ صفقة مفتوحة':'12 open deals'}/><MetricCard href="/dashboard" tone="rose" title={locale==='ar'?'متابعات اليوم':'Follow-ups today'} value="6" icon={CalendarDays} subtitle={locale==='ar'?'تحتاج إلى إجراء':'Need action'}/></div></section></main>}
    function App(){const [open,setOpen]=React.useState(true);return <NextIntlClientProvider locale={locale} messages={locale==='ar'?ar:en} timeZone="Asia/Qatar"><div className="crm-workspace" data-mode="light">{params.get('screen')==='dashboard'?<DashboardProbe/>:<><div id="motion-test" className={'crm-dashboard '+widgetStyles.widget}><span className={widgetStyles.borderOrbit}><span className={widgetStyles.borderLight}/></span></div><button onClick={()=>setOpen(true)}>Reopen</button>{params.get('screen')==='settings'?<PipelineSettings open={open} onOpenChange={setOpen} pipeline={pipeline} stages={[stage]} onPipelinesChanged={()=>{}} onStagesChanged={()=>{}} onCreateNewPipeline={()=>{}}/>:<DealForm open={open} onOpenChange={setOpen} pipelineId="pipeline-1" stages={[stage]} onSaved={()=>{}}/>}</>}</div></NextIntlClientProvider>}
    createRoot(document.getElementById('root')).render(<App/>);
  `
  );
  const config = {
    configFile: false,
    root,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: '@/hooks/use-auth', replacement: join(root, 'auth.ts') },
        { find: '@/hooks/use-can', replacement: join(root, 'can.ts') },
        { find: '@/lib/supabase/client', replacement: join(root, 'client.ts') },
        { find: 'next/link', replacement: join(root, 'link.tsx') },
        { find: '@', replacement: join(project, 'src') },
      ],
    },
    css: { postcss: { plugins: [tailwind({ base: project })] } },
    build: { outDir: join(root, 'dist') },
    preview: { host: '127.0.0.1', port: 0 },
  };
  await build(config);
  server = await preview(config);
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const origin = server.resolvedUrls.local[0];
  const issues = [];
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      page.on('pageerror', (error) => issues.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const screen of ['form', 'settings']) {
        await page.goto(origin + '?locale=' + locale + '&screen=' + screen);
        await page.evaluate((mode) => {
          document.documentElement.dataset.mode = mode;
          document.documentElement.dataset.theme = 'violet';
          document.documentElement.classList.toggle('dark', mode === 'dark');
          document.querySelector('.crm-workspace').dataset.mode = mode;
        }, mode);
        const motion = await page
          .locator('#motion-test span span')
          .evaluate((el) => getComputedStyle(el).animationDuration);
        assert.ok(
          Number.parseFloat(motion) <= 0.01,
          'dashboard decoration ignores reduced motion'
        );
        if (screen === 'form') {
          const title = locale === 'ar' ? 'العنوان' : 'Title';
          const titleInput = page.getByRole('textbox', {
            name: title,
            exact: true,
          });
          await titleInput.waitFor();
          await page.getByText(title, { exact: true }).click();
          assert.equal(
            await titleInput.evaluate((el) => el === document.activeElement),
            true
          );
          await page.keyboard.press('Tab');
          for (const theme of [
            'violet',
            'emerald',
            'cobalt',
            'amber',
            'rose',
            'navy-gold',
          ]) {
            await page.evaluate((theme) => {
              document.documentElement.dataset.theme = theme;
            }, theme);
            const select = page
              .locator('[data-slot="sheet-content"] select')
              .first();
            await select.focus();
            assert.equal(
              await select.evaluate((el) => el.matches(':focus-visible')),
              true
            );
            await page.waitForTimeout(200);
            assert.equal(
              await select.evaluate((el) => getComputedStyle(el).outlineStyle),
              'solid',
              `missing focus in ${theme}`
            );
            const contrast = await page.evaluate(() => {
              const pixel = (value, base = 'white') => {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                const context = canvas.getContext('2d');
                context.fillStyle = base;
                context.fillRect(0, 0, 1, 1);
                context.fillStyle = value;
                context.fillRect(0, 0, 1, 1);
                return Array.from(context.getImageData(0, 0, 1, 1).data).slice(
                  0,
                  3
                );
              };
              const luminance = (channels) => {
                const linear = channels.map((channel) => {
                  const c = channel / 255;
                  return c <= 0.04045
                    ? c / 12.92
                    : ((c + 0.055) / 1.055) ** 2.4;
                });
                return (
                  linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
                );
              };
              const ratio = (a, b) => {
                const x = luminance(pixel(a, b)),
                  y = luminance(pixel(b));
                return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
              };
              const label = document.querySelector(
                '[data-slot="sheet-content"] label'
              );
              const popup = document.querySelector(
                '[data-slot="sheet-content"]'
              );
              const select = document.querySelector(
                '[data-slot="sheet-content"] select'
              );
              return {
                label: ratio(
                  getComputedStyle(label).color,
                  getComputedStyle(popup).backgroundColor
                ),
                focus: ratio(
                  getComputedStyle(select).outlineColor,
                  getComputedStyle(select).backgroundColor
                ),
              };
            });
            assert.ok(
              contrast.label >= 4.5,
              `label contrast ${contrast.label} in ${theme} ${mode}`
            );
            assert.ok(
              contrast.focus >= 3,
              `focus contrast ${contrast.focus} in ${theme} ${mode}`
            );
          }
          for (const input of await page
            .locator(
              '[data-slot="sheet-content"] input, [data-slot="sheet-content"] select, [data-slot="sheet-content"] textarea'
            )
            .all()) {
            assert.ok(
              await input.evaluate((el) => el.labels?.length > 0),
              'unlabelled deal field'
            );
            assert.ok(
              Number.parseFloat(
                await input.evaluate((el) => getComputedStyle(el).fontSize)
              ) >= 16,
              'mobile field below 16px'
            );
          }
        } else {
          const change = page
            .getByRole('button', {
              name: locale === 'ar' ? 'تغيير اللون' : 'Change color',
            })
            .first();
          await change.waitFor();
          assert.ok((await change.boundingBox()).width >= 40);
          await change.click();
          const option = page
            .locator('[data-slot="popover-content"]')
            .getByRole('button', {
              name: locale === 'ar' ? 'اللون #3b82f6' : 'Color #3b82f6',
            });
          await option.waitFor();
          assert.ok((await option.boundingBox()).width >= 40);
          assert.equal(await option.getAttribute('aria-pressed'), 'false');
          await option.click();
          await change.click();
          assert.equal(await option.getAttribute('aria-pressed'), 'true');
          await page.keyboard.press('Escape');
          await option.waitFor({ state: 'hidden' });
          assert.equal(
            await change.evaluate((el) => el === document.activeElement),
            true
          );
        }
      }
      await page.close();
    }
  for (const locale of ['en', 'ar']) {
    for (const mode of ['light', 'dark']) {
      for (const width of [360, 768, 1280, 1440, 2560]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        page.on('pageerror', (error) => issues.push(error.message));
        for (const screen of ['form', 'settings']) {
          await page.goto(origin + '?locale=' + locale + '&screen=' + screen);
          await page.evaluate((mode) => {
            document.documentElement.dataset.mode = mode;
            document.documentElement.dataset.theme = 'violet';
            document.documentElement.classList.toggle('dark', mode === 'dark');
            document.querySelector('.crm-workspace').dataset.mode = mode;
          }, mode);
          const popup = page.locator(
            screen === 'form'
              ? '[data-slot="sheet-content"]'
              : '[data-slot="dialog-content"]'
          );
          await popup.waitFor();
          if (width <= 768) {
            const bounds = await popup.boundingBox();
            assert.ok(
              bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
              `${screen} clips at ${width}px ${locale} ${mode}`
            );
          }
        }
        await page.close();
      }
    }
  }
  const evidenceDir = process.env.UI_REVIEW_EVIDENCE_DIR;
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  for (const locale of ['en', 'ar'])
    for (const mode of ['light', 'dark'])
      for (const width of [390, 1280]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        page.on('pageerror', (error) => issues.push(error.message));
        await page.goto(origin + '?locale=' + locale + '&screen=dashboard');
        await page.evaluate((mode) => {
          document.documentElement.dataset.mode = mode;
          document.documentElement.dataset.theme = 'violet';
          document.documentElement.classList.toggle('dark', mode === 'dark');
          document.querySelector('.crm-workspace').dataset.mode = mode;
        }, mode);
        await page.locator('.crm-metric').first().waitFor();
        assert.equal(await page.locator('.crm-metric').count(), 4);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false,
          `dashboard overflow at ${width} ${locale} ${mode}`
        );
        if (evidenceDir)
          await page.screenshot({
            path: join(evidenceDir, `dashboard-${locale}-${width}-${mode}.png`),
            fullPage: true,
          });
        await page.close();
      }
  assert.deepEqual(issues, []);
  console.log(
    'Deal labels and color picker passed: English/Arabic, light/dark, 360–2560px; keyboard, touch targets, reflow and reduced motion.'
  );
} finally {
  await browser?.close();
  await server?.httpServer.close();
  await rm(root, { recursive: true, force: true });
}
