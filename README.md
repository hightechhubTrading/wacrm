# Hightech Hub

> Hightech Hub's WhatsApp CRM — shared inbox, contacts, sales pipelines,
> broadcasts, no-code automations and flows, and an AI reply assistant, all
> built on Next.js and Supabase.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/hightechhubTrading/wacrm/actions/workflows/ci.yml/badge.svg)](https://github.com/hightechhubTrading/wacrm/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## What it does

- **Shared inbox** on the official WhatsApp Business API — multiple agents
  working one number, per-conversation assignment, status, and notes.
- **Contacts + tags + custom fields**, CSV import, deduplication.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Broadcasts** with Meta-approved templates, delivery + read tracking,
  per-recipient variable substitution.
- **Automations** — triggers on inbound messages, new contacts, keywords, or
  schedule; conditional branches, waits, tags, webhooks. Visual builder.
- **Flows** — a separate visual, node-based builder (built on React Flow) for
  more complex multi-step logic, with its own templates and run history.
- **AI reply assistant** — bring your own OpenAI, Anthropic, Gemini, or
  DeepSeek key (stored encrypted; no per-seat AI fee, your data stays yours).
  One-click AI-drafted replies in the inbox, plus an optional auto-reply bot
  with a per-conversation cap and clean human handoff. Add a **knowledge
  base** (FAQs, policies, product docs) and it answers from your own content
  — hybrid retrieval (Postgres full-text, or semantic pgvector when an
  embeddings key is set).
- **Internal WhatsApp-group notifications** via an optional self-hosted WAHA
  instance — e.g. post a message into an internal ops group when a deal
  enters a flagged pipeline stage. Deliberately isolated from the
  customer-facing Meta Cloud API number, authenticated with its own WhatsApp
  number and per-agent sessions.
- **Real-time dashboard** — response times, daily volume, pipeline value,
  cross-module activity feed.
- **Team accounts** — invite teammates by link, role-based access (owner /
  admin / agent / viewer), ownership transfer. Solo use stays single-user
  with zero setup.
- **Account management** — email, password, avatar, global sign-out.
- **Public REST API** (`/api/v1`) with scoped, revocable API keys — build
  your own automations on top of the CRM. See
  [docs/public-api.md](./docs/public-api.md).
- **MCP server** — drive the CRM from Claude, Cursor, and other AI
  assistants over the [Model Context Protocol](https://modelcontextprotocol.io).
  Read-only by default, opt-in writes. See [docs/mcp.md](./docs/mcp.md)
  (server in [`mcp-server/`](./mcp-server)).

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (official WhatsApp Business API), with an
  optional WAHA container for internal group notifications.
- **Security** — token encryption (AES-256-GCM), RLS on every table,
  HMAC-verified webhooks, CSP, rate limiting, CI typecheck/build on every PR.

## Quick start

```bash
git clone https://github.com/hightechhubTrading/wacrm.git
cd wacrm
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` (or
`/dashboard` if already signed in).

## Deploy on Hostinger

This deployment runs on [Hostinger](https://www.hostinger.com/web-apps-hosting)
Managed Node.js — no Docker, no Kubernetes, no infra team needed.

<p align="center">
  <a href="https://www.hostinger.com/web-apps-hosting">
    <img src="./.github/assets/hostinger-deploy.png" alt="Ship your Node.js app in one click — Deploy to Hostinger" width="900">
  </a>
</p>

| | |
|---|---|
| **One-click Git deploy** | Connect the repo, push to `main`, Hostinger builds and ships it. No SSH, no CI to wire up — this repo's own `main` deploys this way. |
| **Managed Node.js** | Next.js 16 (App Router, server actions, ISR) runs out of the box on Premium, Business, and Cloud shared plans. No managing Node versions, processes, or reverse proxies. |
| **Free SSL + free domain** | Automatic Let's Encrypt on the custom domain. HTTPS is on by default — required for the WhatsApp Business webhook. |
| **Global CDN + LiteSpeed** | Static assets cached at the edge, dynamic routes served from LiteSpeed. |
| **Env vars + logs in hPanel** | Set `SUPABASE_*`, `WHATSAPP_*`, and `ENCRYPTION_KEY` from the panel — no `.env` on the server. Live application logs in the same UI. |
| **DDoS protection + daily backups** | Built-in, no add-ons. |

### The 60-second version

1. In **hPanel → Websites → Create**, pick **Node.js** and connect the repo.
2. Paste the Supabase + Meta env vars into hPanel.
3. Push to `main`. Hostinger builds and serves it. Done.

For a bare VPS/Docker deploy instead, see [`docker-compose.yml`](./docker-compose.yml).

> _Note: MIT-licensed and runs anywhere Node.js does (Vercel, Railway, a
> VPS). Hostinger is what's used in production, not a hard requirement._

## Documentation

- [Public API](./docs/public-api.md) — REST endpoints, auth, scopes.
- [MCP server](./docs/mcp.md) — using the CRM from Claude/Cursor/etc.
- [Contributing](./CONTRIBUTING.md) — local dev loop, PR conventions.
- [Security](./.github/SECURITY.md) — reporting vulnerabilities.

## License

[MIT](./LICENSE).
