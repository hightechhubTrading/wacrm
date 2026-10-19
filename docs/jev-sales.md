# Jev sales communication checks

Jev is a decision layer alongside the configured generative provider. The provider
writes prose; Jev interprets intent and verifies proposed replies/actions. It does
not send messages, grant access, move deals, book visits, calculate quotations or
report inferred sales conversions.

## Configuration and deployment

Set a **server-side** `TYPESAFE_API_KEY` in `.env.local` for development, and in
your deployment's secret environment for production. Do not prefix it with
`NEXT_PUBLIC_`. Restart the app after changing environment variables.

| Variable              | Behavior                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `TYPESAFE_MODE`       | `off`, `shadow`, or `enforce`. Defaults to enforce with a key, off without one.                |
| `TYPESAFE_TIMEOUT_MS` | Per check deadline, default 5000 ms, bounded to 250–10000 ms. No retries on the customer path. |
| `TYPESAFE_MODEL`      | Default `jev-latest`; pin a model when evaluating behavior across releases.                    |

`shadow` performs and logs the checks without altering Jev-controlled routing,
text or actions. `enforce` applies the decision policies described below. An
unavailable input check falls back to cautious generation, without assuming the
customer is upset. Output checks still must pass; an unavailable output check
never silently approves a response. `off` makes no Jev calls.

Migration `068_ai_judgment_log.sql` creates account-scoped audit storage. Apply it
through the normal reviewed migration process. The audit writer is best-effort;
before the table exists, structured server logs retain the check records and
show an audit-storage warning. A storage failure never converts a failed Jev
check into an approval. No production deployment or migration is performed by
merely changing these files. Existing migration 067 has its own WAHA deployment
ordering requirement; review that separately.

## Current workflow

Automatic replies run after existing consent, flow/automation ownership,
business-hours, assignment, reply-cap and debounce gates. The account throttle
now precedes optional summary generation and the Jev input call.

1. One input request asks independent questions about intent, expressed emotional
   tone, current dissatisfaction, an explicit human request, and explicit
   complaints about repeated/ignored answers, and whether an earlier recovery
   attempt actually failed.
2. An explicit human request or strongly corroborated severe anger uses the
   existing handoff path immediately. A first complaint, mild frustration or
   disappointment gets a useful recovery reply. Persistent dissatisfaction after
   an actual recovery attempt requires handoff. Otherwise constant
   intent-specific guidance helps the generator answer pricing/questions directly,
   gather one missing detail, or acknowledge an existing order/complaint.
3. Generate with the existing provider and evidence. Correct the reply language
   and phone formatting before checking the final text.
4. One output request verifies business claim support, relevance/no repeated
   answered questions, selected product/media relevance, and each proposed lead
   field value. All independent questions are batched.
5. A rejected candidate gets one fresh generation and the same full output checks
   before handoff. The rejected text is never sent; a second rejection requires
   human review. Unsupported optional fields,
   product tags and attachments are filtered independently. Fields are checked
   even when the generator requested a handoff. Existence and field allowlists
   are also checked in code.
6. Recheck the latest customer message, AI-disabled state and human assignment
   before effects. Field writes additionally require the verified deal/stage to
   remain current. Existing sender opt-out checks and atomic reply-slot claims
   remain in force.

This is not an exactly-once or fully transactional send system: customer state
can change after any read, and send/persistence/attachments remain separate
operations. The added checks narrow the stale-response window.

Draft suggestions and the playground also use input guidance and output checks.
A draft needing review returns HTTP 422 with `ai_human_review`, so unsupported
text is not inserted into the composer. The playground shows handoff without
sending WhatsApp messages. These routes do not execute generated field/media
proposals. They use their existing context, which is less rich than live auto-reply
(no complete account-hours/order snapshot).

## Evidence and decisions

Only conversation context and the relevant business/catalog/knowledge facts are
sent to TypeSafe. Provider credentials are never part of state. Image descriptions
remain labelled as inferences; the lead-field verifier uses customer-authored
statements, including transcribed audio, and excludes inferred image captions.
Knowledge excerpts currently retain their text but not original chunk IDs; full
per-claim source tracing is a future improvement.

Policy: explicit human requests and failed-recovery judgments need probability
>= 0.90; severe anger requires both angry Choice confidence and dissatisfaction
probability >= 0.95. Output support
needs >= 0.85; intent guidance needs Choice confidence >= 0.65. These are initial
conservative settings checked on synthetic fixtures, not guarantees of accuracy
on all customer dialects/products. Low intent confidence yields clarification
advice, not an automatic handoff. Noul probabilities and Choice confidence have
different meanings and are not interchangeable.

The end layer also compares explicitly currency-labelled base-price amounts to
the selected configured range in code (Western/Arabic digits and common range
formats). It deliberately skips that narrow numeric check when add-on pricing
notes exist; Jev checks those conditions semantically. It does not calculate
area, taxes, discounts, units or final quotation totals. Existing pricing and
repeated-price-ask backstops remain.

One bounded rewrite is available in auto-replies, drafts and the playground.
Only the replacement that passes verification can be used. It is not retried
again. An explicit model handoff is respected without rewriting it. Exhausted
failed/unavailable output checks route an auto-reply to the existing fixed closing
message, disable AI on the thread, and notify the configured teammate/admin queue.
Replacement generation is usage-logged on auto-reply/draft paths, and automatic
replies recheck freshness/ownership before regeneration and before effects. Staff can re-enable AI using the
existing controls. Optional rejected actions do not prevent supported text.

## Emotion-aware replies and human handoff

The input batch estimates the latest customer-authored tone as neutral, positive,
confused, concerned, sad, disappointed, frustrated, angry or unclear. An independent
Noul checks current dissatisfaction, including indirect irritation and sarcasm.
Earlier turns provide context; resolved past anger, inferred attachment descriptions,
urgency, capitals and ordinary repair/price questions alone do not justify escalation.

In enforce mode, mild frustration, disappointment and first complaints receive
specific acknowledgment and useful help rather than an immediate sticky handoff.
A recovery-failed judgment requires chronological evidence of an earlier customer
complaint, an intervening assistant recovery attempt, and continuing dissatisfaction
about the same issue. It must reach **0.90** and be accompanied by a current
complaint/dissatisfaction signal. A repeated pricing question or a first correction
alone does not establish failed recovery.

Immediate emotional handoff requires **angry** Choice confidence **>= 0.95** AND
current dissatisfaction probability **>= 0.95**. Explicit human requests still
transfer immediately without qualification. Genuine handoffs retain the existing
English/Arabic closing, assignment, review task and notifications; AI stays paused
until staff resume it. These are initial operating thresholds, not a claim of
customer-domain calibration.

Confusion, worry, sadness and recoverable dissatisfaction add calm, specific,
non-pushy guidance. An output empathy check must score **>= 0.85** before sending.
The single rewrite opportunity also applies to a rejected tone; tone is never
made acceptable by bypassing verification. Missing input judgments use cautious
generation and still require output verification. Shadow mode records hypothetical
decisions without changing behavior; off mode makes no Jev calls.

The application routing policy follows saved business instructions in the prompt
and explicitly takes precedence over conflicting emotion-only/missing-information
handoff wording. Business restrictions on prices, discounts, bookings and promises
remain. The existing unverified-price and repeated-price-request backstops remain.

### Audit findings behind the recovery change, 2026-10-15

Read-only inspection of the connected database found 10 automatic-reply output
checks: 6 handoffs, 3 allowed and 1 with optional actions filtered. All 10 input
checks allowed continuation. Thus these records point to rejected reply content,
not emotional input routing, as the immediate source of the observed transfers.
Some candidates failed claim support/completed-action checks; others were near the
support threshold. Thresholds were not lowered to let these claims through.
Internal assistance checks are a separate workflow and are not customer handoffs.
The saved business prompt also instructed transfer for missing information or
frustration; the shared routing policy now resolves that conflict.

This inspection did not change live account settings or verify the running VPS
checkout/environment. Source changes and local/live synthetic evaluations do not
constitute a production deployment.

## Observability

`src/lib/ai/typesafe/audit.ts` logs question version, account/conversation/trigger
IDs, layer, mode, hypothetical outcome, model, token usage, latency and sanitized
judgments. Output judgments include `attempt` (0 = initial candidate, 1 =
replacement); a rejected initial candidate is not necessarily a completed customer
handoff. Shadow outcomes describe what would have happened. It stores no raw
messages, reply text, field values, API keys or remote error bodies. Audit records
are readable by account admins through RLS; inserts use the service-role client
on the automatic path. Draft/playground currently use structured logs only.
Choose an operational retention period for the audit table/logs.

## Evaluation and code ownership

- `client.ts`: bounded server-side SDK calls and mode configuration.
- `sales.ts`: typed input/output questions, evidence contract, orchestration.
- `policy.ts`: initial thresholds, intent guidance, customer-statement provenance.
- `emotion.ts`: tone labels, confidence policy, empathy guidance and fixed bilingual apologies.
- `price.ts`: narrow deterministic currency/range reconciliation.
- `audit.ts`: sanitized structured logging and optional persistence.
- `auto-reply.ts`: actual automatic routing, validation and side-effect boundary.
- `collect-fields.ts`: reject a changed verified order/stage before writes.
- `api/ai/draft/route.ts`, `api/ai/playground/route.ts`: suggestion/test workflows.

Normal tests never make paid TypeSafe calls:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

To intentionally run the paid, synthetic-only English/Gulf Arabic fixtures with
your local key:

```sh
npm run test:jev
```

The initial fixtures include valid estimates, invented discounts/commitments,
wrong amounts, repeated answered questions, explicit human requests and normal
quotation intent. Emotion fixtures add English/Gulf Arabic anger/frustration,
sarcasm, disappointment, confusion/worry, calm repair/price negotiation, urgent
capitals, resolved past anger and empathetic/dismissive output examples. They are
a small smoke evaluation. Expand with labelled domain
cases before broader enforcement; compare false handoffs, missed errors,
field-write correctness, latency and cost. Never copy customer exports or keys
into repository tests or the Obsidian vault.

Official references: [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md),
[Confidence](https://docs.typesafe.ai/confidence.md),
[LLM input/output guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails.md).

## Conversation review improvements (October 12, 2026)

The inbox now has a **Follow-up work** panel with the last auto-reply attempt,
its skip/failure reason, and durable human tasks. A human can take ownership,
confirm an appointment, defer until a future date, cancel, or complete a task
with an explanation of what actually happened. Completing a task requires the
authenticated actor and at least ten characters of completion evidence; a
requested time is distinct from a team-confirmed time. Active tasks are
atomically deduplicated by conversation and kind. Existing human assignments
and thread pause settings are preserved; no historical backlog is reset.

Apply migration **069_ai_followup_and_reply_events.sql**, plus **068** for Jev
audits, before deploying this code. These are additive and independent of the
WAHA removal in 067. The new tables inherit conversation visibility through
RLS. Clients have read access only; server writes must pass the conversation's
RLS/account gate. Source messages and owners are checked against the account.
The existing authenticated `/api/automations/cron` job also delivers due
follow-up reminders to staff; schedule it regularly using its existing
`AUTOMATION_CRON_SECRET` header. It never sends a customer message. An hourly
claim lease prevents duplicate concurrent reminders, and successful notices
move the next reminder out by a day. Deferred tasks wait until their due date.

Regular replies and human drafts now receive bounded, verbatim older customer
statements with source-message references and recorded work, alongside recent
turns. Generated rolling summaries remain staff recaps and are not promoted to
verified business evidence. Recent corrections override older statements.
Parsed older document extracts are included separately; they do not become
explicitly customer-stated lead field values.

Inbound PDF, XLSX, UTF-8 text and CSV documents are parsed locally. Downloads
are capped at 5 MiB with a ten-second network timeout. PDFs are limited to ten
pages of text; XLSX expanded ZIP content is capped at 20 MiB, ten sheets,
500 rows/sheet and 5,000 cells. Extracted text is capped at 16,000 characters.
Partial results are labelled. This is text extraction, not OCR, DWG reading or
visual drawing interpretation. Scans, unsupported/encrypted/corrupt files and
untranscribed audio produce human-review work rather than a fabricated reading.
Set `AI_DOCUMENT_PARSING_ENABLED=false` to disable local parsing. No existing
attachments are downloaded/backfilled automatically.

### New Jev checks and calibration

`TYPESAFE_SALES_V2_MODE=shadow` is the default for review-derived action routing
and document/operation/customer-scope/multiple-request checks. `enforce` opts
these into controlling routing and sends; `off` disables the new output
questions. The original `TYPESAFE_MODE` remains the overall Jev switch. New
questions share the same request; their raw judgments are available in audit
records. They do not grant permission or execute customer actions.

Routing distinguishes repair, supplier, wrong contact and customer deferral,
and can retain independent location/comparison requests. Automatic task
creation from semantic action selection requires v2 enforcement; actual
handoffs and unreadable-attachment review create durable work independently.
A customer's explicit deferral suppresses repeated-price escalation when the
independent deferral judgment and intent agree. Requests for lower prices
must preserve fixed dimensions and approved catalog/quotation evidence.
Arithmetic and final quotation approval remain deterministic/human-owned.

The paid synthetic suite now includes unparsed-file claims, a five-versus-four
window scope change, fictional bookings, inspection intake, conditional offers
and multiple unanswered requests, alongside the original pricing and emotion
fixtures. New checks remain in shadow until representative held-out, labelled
customer cases establish their false-positive/false-negative rates. A passing
synthetic suite is a smoke check, not production-domain calibration. Customer
transcripts and review exports stay out of committed fixtures.

## Independent internal sales preparation

The first internal assistance phase now prepares summaries/next actions and
checks approved tag matches and customer-stated fields independently of
auto-reply ownership/pause. Its own mode defaults to shadow. Code applies
verified internal writes atomically after freshness/scope checks; Jev remains
a decision/verifier layer. See [sales-assistance.md](sales-assistance.md) for
activation, tag automation behavior, source limits and verification.

## Review fixes, October 17, 2026

Local question version `sales-v5-evidence-recovery` aligns internal assistance
verification with the saved fields supplied to its generator. Saved values can
support a recap/next-action recommendation, but do not establish a completed
business operation or replace the customer source required for new field capture.
Latest customer corrections still take precedence.

Conversation context and auto-reply freshness now use `received_at` followed by
`id` to break equal `created_at` timestamps, matching the internal assistance
ordering. This keeps same-second message bursts deterministic.

The single rewrite receives specific guidance for each failed enforced check:
grounding, responsiveness, empathy, price range and, when v2 is enforced,
document access, completed operations, scope and independent requests. Shadow-only
failures do not become rewrite instructions. Service unavailability is distinguished
from a content rejection. Thresholds, the one-rewrite limit and full replacement
verification remain unchanged.

Verification: 1,373 unit tests passed (30 paid fixtures skipped in normal tests),
TypeScript and scoped lint passed. The explicit live synthetic suite passed all
30 cases on the post-change run. The pre-change run passed 29/30, falsely rejecting
an inspection clarification at a completion score of 0.84. That question/threshold
was not changed; a passing rerun does not resolve the observed model variability.
Production accuracy still needs held-out bilingual calibration and post-deployment
measurement. No deployment, account switch, threshold change or customer send was
performed during this work.

## Catalog and recovery update, 2026-10-18

Local policy `sales-v6-catalog-recovery` implements the conversation-audit fixes:
reviewed family/product/variant evidence, catalog-backed draft suggestions,
contextual/source-labelled knowledge retrieval, repair of premature generated
handoffs, price/tag correction before transfer, and a fully verified narrow
clarification fallback for ambiguous shutter pricing. Repeated pricing questions
no longer force handoff through a simple counter. Support thresholds remain
unchanged. Questions and conditional next steps are explicitly distinguished from
unsupported claims and completed operations; independent known-answer requests
are checked separately from primary response relevance.

Migration 077 adds catalog structure/review/source fields, approved-only retrieval,
atomic research-draft import and structured final handoff reasons. Apply it before
the new application; import drafts only after the approved-only runtime is active.
Existing catalog rows remain approved. The HTH research map includes ten families,
24 products and five variants from the vault/company site, with no new prices or
unverified technical guarantees. Full editor, evidence rules, source conflicts,
validation and deployment order: [Knowledge and catalog guide](ai-knowledge-catalog.md).
These local changes do not constitute a production deployment.

Preview follow-up: migration 077 was subsequently applied to the connected database
as `20261018190000` to fix the local editor's missing-column error. Product and
knowledge queries passed; three existing products and their numeric price amounts
were preserved. Research import and application deployment remain separate.
