# Contributing

## Setup

```bash
git clone https://github.com/hightechhubTrading/wacrm.git
cd wacrm

cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm install
npm run dev
```

Full setup (Supabase migrations, WhatsApp Business API, deploy) lives in
[`docs/`](./docs/).

## Reporting security issues

**Do not file security issues publicly.** Follow the private flow in
[SECURITY.md](./.github/SECURITY.md).

## Pull requests

- Branch off the latest `main` (don't push to a merged branch — commits end
  up orphaned).
- Run `npm run typecheck` and `npm run format` locally first.
- Fill in the PR template, especially the **Test plan**.
- One logical change per PR.
- Commit-message first line is imperative + terse; the body explains the
  *why*, the diff shows the *what*.

## Dev-loop reference

| Command | What it does |
| --- | --- |
| `npm run dev` | Turbopack dev server on port 3000. |
| `npm run build` | Production build. Next also runs its own typecheck here. |
| `npm run typecheck` | `tsc --noEmit`. Fast TS-only pass. |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier in check-only mode. Useful in CI. |
| `npm run test` | Vitest run. |

## Licensing

This project is MIT ([`LICENSE`](./LICENSE)).
