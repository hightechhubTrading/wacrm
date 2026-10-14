import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { spawnSync } from 'node:child_process';

// Explicit paid evaluation on synthetic fixtures only; never print credentials.
loadEnvConfig(process.cwd());
if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error('Set TYPESAFE_API_KEY in .env.local before evaluating Jev.');
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    'src/lib/ai/typesafe/sales.live.test.ts',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      TYPESAFE_MODE: 'enforce',
      TYPESAFE_SALES_V2_MODE: 'enforce',
      TYPESAFE_LIVE_TEST: 'true',
    },
  }
);
process.exitCode = result.status ?? 1;
