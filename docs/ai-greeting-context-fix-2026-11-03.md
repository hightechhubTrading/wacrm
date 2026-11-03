# Greeting verification overflow — 3 November 2026

A playground request containing only `مرحبا` failed after the model generated a reply. Production logs showed successful input interpretation followed by output-verification `unavailable` events on every attempt. The account had been changed to OpenAI `gpt-6.1-terra` by this point.

Read-only reproduction with the real account configuration and catalogue identified the cause: an unmatched enquiry caused `productContext` to return all 123 approved entries. The evidence contained 166,694 characters. TypeSafe returned HTTP 400 with `error_type=max_tokens_exceeded`. The previous synthetic evaluations used small catalogues and did not detect this company-sized context failure.

## Change

- An isolated greeting receives no product catalogue context. It still goes through actual provider generation and reply verification; no greeting response is hard-coded and the verifier is not bypassed.
- Other enquiries receive at most eight complete product records, ranked using current explicit names/aliases, retrieved product references and recent conversation. Late-inventory matches are eligible; this is not simply the first eight records. Discovery prefers approved product families. Parents fit into the same budget after direct matches, and prices are never inherited.
- Source records, qualifications and pricing conditions are retained whole. No inventory, quotation or knowledge records are removed or rewritten. The prompt explicitly identifies the catalogue as a retrieved subset, so omission cannot establish that a product is unavailable.
- Greeting-plus-request and greetings inside an existing conversation retain relevant product context. English/Arabic greeting punctuation and Arabic diacritics are normalized for the isolated-greeting check.
- Output audits now identify `context_limit` through a fixed code. SDK error bodies, credentials, drafts and evidence remain excluded from audit logs. Question/context version: `sales-v12-bounded-catalogue`.

The shared selector is used by playground, live auto-reply and drafts. Account settings, selected model and credentials are unchanged. No migration is needed.

## Validation

The exact `judgeSalesOutput` reproduction succeeds after selection is corrected. The actual playground POST handler then returned HTTP 200 with nonempty, verified replies for `مرحبا`, `Hello!`, a UPVC enquiry and a general product-discovery question, using the real configured Terra provider and company catalogue. Authentication alone was supplied by the test harness; retrieval, context selection, generation and verification were real. These synthetic requests did not send WhatsApp messages or create authentication sessions.

The first broader discovery probe still needed review before family discovery was corrected to use the existing `family` catalogue kind. All four final route probes passed. Regression coverage includes a 123-record catalogue, greetings with additional requests/history, complete late-inventory matches, family discovery, and sanitized context-limit diagnostics. The earlier product-tag unit fixture was corrected to contain an actual product request rather than the unrelated default greeting.

Full suite: 1,675 passed, 74 opt-in tests skipped. TypeScript, production build, targeted ESLint and 35 deployment-preflight tests passed.

A separate existing embeddings credential was rejected as invalid during retrieval; the existing lexical-search fallback continued to work. This was not the greeting-verification failure. Credentials were not replaced by this fix.

Deployment verification will be recorded after rollout.
