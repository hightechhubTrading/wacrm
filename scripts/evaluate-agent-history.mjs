import nextEnv from '@next/env';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.AI_HISTORY_EVAL_DIR || !process.env.TYPESAFE_API_KEY) {
  console.error(
    'Set AI_HISTORY_EVAL_DIR to a private frozen fixture directory and configure TypeSafe before running.'
  );
  process.exit(1);
}
const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(process.env.AI_HISTORY_EVAL_DIR, 'fixtures.json'),
    'utf8'
  )
);
const cases = fixtures.filter(
  (f) =>
    (!process.env.AI_HISTORY_SPLIT ||
      f.split === process.env.AI_HISTORY_SPLIT) &&
    (!process.env.AI_HISTORY_CASES ||
      process.env.AI_HISTORY_CASES.split(',').includes(f.id))
);
const maxCases = Math.max(
  1,
  Math.min(134, Number(process.env.AI_HISTORY_MAX_CASES) || 12)
);
if (cases.length > maxCases && process.env.AI_HISTORY_SNIPPET_ONLY !== 'true') {
  console.error(
    'Paid replay exceeds the configured case budget. Select a smaller batch or explicitly set AI_HISTORY_MAX_CASES and AI_HISTORY_MAX_GENERATIONS.'
  );
  process.exit(1);
}
const child = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    'vitest.agent-history.config.ts',
    'src/lib/ai/behavior-history.live.test.ts',
    '--maxConcurrency',
    String(
      Math.max(1, Math.min(3, Number(process.env.AI_HISTORY_CONCURRENCY) || 2))
    ),
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, AI_HISTORY_EVAL: 'true', TYPESAFE_MODE: 'enforce' },
  }
);
process.exitCode = child.status ?? 1;
