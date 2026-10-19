# AI behavior audit — 18 October 2026

Publication-safe summary of the authorized internal conversation audit. Customer identifiers, verbatim conversations and per-conversation timestamps are intentionally excluded. Detailed evidence remains in private local exports outside the repository.

## Scope

A read-only rolling seven-day review covered 296 messages across 59 active conversations, including all 33 conversations with AI-generated replies. The review compared persisted messages, current catalog/configuration, and automatic-reply decision logs. Attachment binaries were not downloaded. Current snapshots do not prove historical source revisions or the deployed checkout/environment.

| Measure | Result |
| --- | ---: |
| Conversations with AI responses | 33 |
| Observed final handoffs | 24 (72.7%) |
| First-response handoffs | 17 (51.5%) |
| Automatic-reply input checks | 45; all allowed continuation |
| Logged recovery attempts | 17; one recovered |
| Replies sharing the configured window-shutter estimate | 0 |

These are observed rates, not rates of avoidable transfers. Some technical/scheduling transfers were appropriate. No sales-loss or conversion estimate is implied. Internal sales-assistance checks and intermediate rejected candidates were excluded from customer handoff counts.

## Representative failure

An ordinary shutter price-per-unit enquiry was classified as neutral pricing with intent confidence 1.00. The input check allowed continuation. The initial candidate and one replacement passed grounding but failed responsiveness (0.77 and 0.81 against a 0.85 cutoff), causing the fixed handoff closing and a sticky AI pause.

The rejected candidate wording was not stored, so the evidence establishes rejection/retry/transfer, not whether the generated replies were poor or the verifier rejected acceptable clarification. Additional low advisory scores cannot be treated as enforcement causes when their mode was shadow.

## Findings

1. **Answer rejection becomes transfer.** Only one of 17 retries recovered. Keep failed wording separate from actual need for human authority. Validate repairs and a bounded supported clarification; never send rejected text simply to reduce handoff counts.
2. **Product categories are conflated.** The configured window-shutter estimate did not cover garage/shop doors. Clarify the exact product, retain its unit/inclusions, and never borrow sibling pricing. Resolve unclear manual-operation charges with the company.
3. **Routine ad enquiries lose the first useful answer.** Use actual ad context as evidence, explain supported product facts, and ask only a necessary unanswered clarification.
4. **Inspection requests get generic closings.** Acknowledge the requested inspection, collect a missing site detail and distinguish requested scheduling from a confirmed booking. Answer independent known company questions before transfer.
5. **Prompt rules conflict.** Consolidate routing policy. Repeated prices indicate a failed answer, not an automatic need to transfer. Move price/tag consistency into repair before the final send gate.
6. **Non-sales enquiries share the sales queue.** Separate job/supplier/wrong-contact guidance from product qualification; do not invent a hiring contact or vacancy.
7. **Final handoff reasons are missing.** Record actual routing reason, failed enforced dimensions, attempt, source/product IDs and policy version. Separate advisory decisions, candidate rejections and completed transfers in reporting.

Do not lower all thresholds to compensate for poor evidence or question definitions. [TypeSafe confidence guidance](https://docs.typesafe.ai/confidence) recommends domain/risk-based calibration; its [guardrail cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails) keeps application policy separate from model judgments.

## Resulting implementation and limits

The implementation adds reviewed family/product/variant evidence, source-labelled retrieval, catalog evidence for drafts, targeted verification/repair, and structured handoff reasons. See [the knowledge and catalog guide](ai-knowledge-catalog.md) and [Jev workflow documentation](jev-sales.md).

The normal regression suite and opt-in synthetic decision tests cover both useful continuations and blocked unsupported claims. Synthetic success does not establish a measured reduction in live transfers. Deployment must verify required migrations and the active runtime version separately.
