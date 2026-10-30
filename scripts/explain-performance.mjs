/** Read-only EXPLAIN of prepared RPC bodies against the linked database.
 * No function or index is installed. Raw plans stay in a temporary directory;
 * the report contains timings and relation names, never account/user IDs. */
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const operations = {
  pipeline: {
    file: '085_pipeline_list.sql',
    name: 'pipeline_list',
    types: 'uuid,jsonb,text,integer,jsonb,date,date,text',
    parameters: [
      'p_pipeline',
      'p_filters',
      'p_view',
      'p_page',
      'p_stage_pages',
      'p_today',
      'p_week_end',
      'p_fallback_currency',
    ],
    values:
      "current_setting('perf.pipeline')::uuid,'{}','board',0,'{}',current_date,current_date+7,'QAR'",
  },
  inbox: {
    file: '084_inbox_list.sql',
    name: 'inbox_list',
    types:
      'uuid,text,text,text,uuid[],text,text,timestamptz,jsonb,integer,boolean,boolean',
    parameters: [
      'p_account',
      'p_search',
      'p_view',
      'p_sort',
      'p_tags',
      'p_company',
      'p_agent',
      'p_day_end',
      'p_cursor',
      'p_limit',
      'p_sales',
      'p_metadata_only',
    ],
    values:
      "current_setting('perf.account')::uuid,'','all','priority','{}',NULL,NULL,now(),NULL,50,false,false",
  },
  metrics: {
    file: '083_dashboard_aggregates.sql',
    name: 'dashboard_metrics',
    types: 'timestamptz,timestamptz',
    parameters: ['p_today', 'p_yesterday'],
    values: 'current_date::timestamptz,(current_date-1)::timestamptz',
  },
  series: {
    file: '083_dashboard_aggregates.sql',
    name: 'dashboard_message_series',
    types: 'timestamptz,integer,text',
    parameters: ['p_start', 'p_days', 'p_timezone'],
    values: "(current_date-29)::timestamptz,30,'Europe/Berlin'",
  },
  response: {
    file: '083_dashboard_aggregates.sql',
    name: 'dashboard_response_time',
    types: 'timestamptz,timestamptz,timestamptz,text',
    parameters: ['p_start', 'p_this_week', 'p_last_week', 'p_timezone'],
    values:
      "(current_date-13)::timestamptz,date_trunc('week',now()),date_trunc('week',now())-interval '7 days','Europe/Berlin'",
  },
};
operations.account = {
  file: '086_account_profile.sql',
  name: 'account_profile',
  types: '',
  parameters: [],
  values: '',
};
operations.inboxCounts = {
  ...operations.inbox,
  values:
    "current_setting('perf.account')::uuid,'','all','priority','{}',NULL,NULL,now(),NULL,50,true,true",
};
const requested = process.argv[2] || 'all',
  selected = requested === 'all' ? Object.keys(operations) : [requested];
if (selected.some((name) => !operations[name]))
  throw new Error('Expected all, pipeline, inbox, metrics, series or response');
const directory = await mkdtemp(join(tmpdir(), 'wacrm-query-plans-'));
const report = {
  measuredAt: new Date().toISOString(),
  environment:
    'Linked database, authenticated table RLS, read-only transaction; prepared SQL bodies, not installed RPCs.',
  operations: {},
};
try {
  for (const key of selected) {
    const op = operations[key],
      source = await readFile(join('supabase/migrations', op.file), 'utf8');
    const start = source.indexOf(`FUNCTION public.${op.name}(`),
      begin = source.indexOf('AS $$', start),
      end = source.indexOf('$$;', begin);
    if (start < 0 || begin < 0 || end < 0)
      throw new Error(`Could not locate ${op.name}`);
    let body = source.slice(begin + 5, end);
    op.parameters.forEach((parameter, index) => {
      body = body.replace(
        new RegExp(`\\b${parameter}\\b`, 'g'),
        () => `$${index + 1}`
      );
    });
    const sql = `BEGIN READ ONLY;SET LOCAL statement_timeout='20s';
SELECT set_config('request.jwt.claim.sub',(SELECT user_id::text FROM profiles WHERE account_role='owner' ORDER BY (SELECT count(*) FROM conversations c WHERE c.account_id=profiles.account_id) DESC LIMIT 1),true);
SELECT set_config('perf.account',(SELECT account_id::text FROM profiles WHERE user_id=current_setting('request.jwt.claim.sub')::uuid LIMIT 1),true);
SELECT set_config('perf.pipeline',(SELECT id::text FROM pipelines WHERE account_id=current_setting('perf.account')::uuid ORDER BY created_at LIMIT 1),true);
SET LOCAL ROLE authenticated;
PREPARE perf_query${op.types ? '(' + op.types + ')' : ''} AS ${body};
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE perf_query${op.values ? '(' + op.values + ')' : ''};`;
    const file = join(directory, `${key}.sql`);
    await writeFile(file, sql);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        'supabase',
        ['db', 'query', '--linked', '--file', file],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (data) => (stdout += data));
      child.stderr.on('data', (data) => (stderr += data));
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0
          ? resolve(stdout)
          : reject(new Error(`EXPLAIN ${key} failed: ${stderr.slice(0, 600)}`))
      );
    });
    const plan = JSON.parse(output).rows.find((row) => row['QUERY PLAN'])?.[
      'QUERY PLAN'
    ]?.[0];
    if (!plan) throw new Error('No EXPLAIN result returned');
    const nodes = [];
    function walk(node) {
      if (node['Relation Name'])
        nodes.push({
          type: node['Node Type'],
          relation: node['Relation Name'],
          loops: node['Actual Loops'],
          rowsPerLoop: node['Actual Rows'],
          totalMs: Number(
            (node['Actual Total Time'] * node['Actual Loops']).toFixed(3)
          ),
        });
      for (const child of node.Plans || []) walk(child);
    }
    walk(plan.Plan);
    report.operations[key] = {
      sqlSha256: createHash('sha256').update(source).digest('hex'),
      planningMs: plan['Planning Time'],
      executionMs: plan['Execution Time'],
      sharedHitBlocks: plan.Plan['Shared Hit Blocks'],
      sharedReadBlocks: plan.Plan['Shared Read Blocks'],
      relations: nodes.sort((a, b) => b.totalMs - a.totalMs),
    };
    console.log(`${key}: ${plan['Execution Time']} ms`);
  }
  const file = resolve(
    process.env.PERFORMANCE_PLAN_REPORT || 'docs/performance-query-plans.json'
  );
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`Sanitized plan report: ${file}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
