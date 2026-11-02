<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project knowledge map

The Obsidian project hub is `/Users/naderismail/Documents/Personal Knowledge/wiki/clients/hth/Projects/WhatsApp CRM.md`. Before substantial architecture or AI-workflow changes, consult its linked code atlas, architecture, working guide and Jev proposal. Follow the vault's own `AGENTS.md` when updating notes. The map was inspected on 2026-10-12; verify referenced paths and current code before relying on it. Jev input/output layers are implemented locally; see `docs/jev-sales.md` and `src/lib/ai/typesafe/`. Verify deployment and environment separately. Use the installed `typesafe-ai` skill and live TypeSafe docs for relevant AI integration work.

## Company records and normalization

Treat the supplied HTH company archive as documented business evidence. Clean English, naming, codes and organization directly while preserving source meaning, recorded amounts and original references. Do not request fresh company validation for routine cleanup or facts already established by their records. Keep open questions for genuine missing facts, conflicts and operational decisions; distinguish a documented record from a completed pricing calculation. See `docs/company-record-normalization.md`.
