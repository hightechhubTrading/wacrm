# General product explanations

The reported playground conversation offered solid, perforated and transparent shop shutters, then handed off when the customer asked “وش الفرق؟”. Synthetic live tests reproduced an evidence-policy problem: three correct comparisons/suitability replies failed the `grounded` check because the catalog did not spell out their basic category meanings. The initial support scores were 0.30, 0.57 and 0.52 against the existing 0.85 threshold. This reproduces a failure mechanism; it is not a recovered production trace of the screenshot.

## Behavior

Policy version: `sales-v7-product-education`. Implemented locally; not deployed.

- Explain ordinary category meanings, qualitative visual differences and conditional selection preferences in the customer's language. A basic comparison does not need measurements first. Resolve short comparison follow-ups from the conversation, without treating earlier assistant suggestions as proof of exact business facts.
- Keep company availability, exact configurations, materials/grades, brands, prices, warranties, ratings and lead times tied to approved business evidence. “Generally” does not permit inventing an HTH guarantee. General category knowledge cannot supply an exact price or a product tag/file/action.
- Use `src/lib/ai/product-education.ts` in both the generator prompt and verifier state. It defines the boundary and a small reference of category meanings (solid/perforated/transparent shutter visibility and pivot/side-hinge terminology). These meanings are separate from the supplied company catalog; no draft product is approved or indexed by this change. Other accurate basic product education is allowed by the policy too.
- Judge company evidence support (`grounded`) independently from general explanation accuracy (`education`). Both are enforced with the unchanged 0.85 support threshold. False category definitions and unsupported performance guarantees still fail. Product/media/field allowlists, explicit-human routing, pricing checks and bounded recovery stay in place.
- Responsiveness distinguishes a comparison of identified categories from an ambiguous price request. “الشتر بكم المتر؟” may still require windows-versus-garage/shop clarification. Merely having a product in the catalog does not establish the customer's selection.

This adds one batched output judgment and a small shared reference payload. It does not add another verifier round trip or bypass verification. A verifier outage still follows the existing conservative handling.

## Verification

The synthetic transcript was replayed locally with the account's actual configured provider, business prompt, approved catalog and retrieval. It returned, without handoff:

> المصمت يحجب الرؤية، والمخرم يسمح برؤية جزئية حسب التخريم، والبولي كربونات الشفاف يُبقي واجهة العرض ظاهرة والباب مغلق.
> تفضّل حجب الرؤية أو بقاء المعروضات ظاهرة؟

The reply passed the enforced factual/education/relevance checks. A product tag chosen by the generator was separately filtered as irrelevant, demonstrating that useful text does not authorize a product action. The replay used synthetic customer messages, no WhatsApp send path and no database-backed audit writer. No customer conversation was resumed or modified.

Live evaluation includes Arabic/English comparisons, conditional advice, pivot terminology, invented company ratings/warranties, a misleading “generally our products…” claim, false definitions and measurement-only deflection. Existing estimate, ambiguity, emotion, handoff and document-access regression cases remain in the same opt-in suite. Initial wording changes still rejected one Arabic comparison; separating the judgments and supplying category meanings in state resolved that probe. A subsequent full-suite run caught an ambiguous Arabic price clarification near the cutoff; the response question was restructured by request type rather than lowering the threshold.

The integration follows the installed TypeSafe skill and current [Noul guidance](https://docs.typesafe.ai/primitives/noul), [JavaScript SDK reference](https://docs.typesafe.ai/sdk/javascript) and [guardrails cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails), inspected 28 October 2026. Typed decisions remain in Jev; code composes them and controls effects. API request contracts and model aliases were not changed.


Final checks: 1,433 normal tests passed (43 paid cases skipped in normal CI); all 43 opt-in live Jev tests passed; TypeScript, scoped lint and the production webpack build passed. The safe-booking-rewrite fixture was clarified to use an identified, unpriced window shutter: asking for height is valid in that state, whereas the earlier fixture ambiguously asked for a price despite containing a configured estimate. No support/handoff thresholds were lowered.

## Product-family customer guides

The local implementation now also provides typed, five-section customer guides stored once in the knowledge library and edited through the product page. Ten family templates are prepared as bilingual drafts. Retrieval labels educational passages distinctly; the verifier must not use a customer-guide passage as evidence for an HTH warranty or other exact company commitment. Two additional live cases verify an educational explanation without company-supply assertions and rejection of an invented company warranty. All **45** live cases pass with this extension. See [catalog guide implementation](ai-knowledge-catalog.md#customer-guides-across-the-catalog--28-october-2026) for schema, sharing, import and rollout details. The source still requires migration/deployment; the live agent has not changed.


### Customer wording — 28 October 2026 (local)

Generation and verified repair share `src/lib/ai/customer-tone.ts`. Casual Arabic replies use clear everyday Gulf wording; formal customers get simple polite Arabic, and English customers keep English. Replies answer the current point, avoid repeated greetings and canned acknowledgments, and preserve exact facts, uncertainty, prices and safety limits. Fixed handoff/clarification replies and customer-guide question examples use simpler wording too. There is no post-verification style rewrite. This is a local change, not a deployment.

Validation: 73 focused tests, TypeScript and focused ESLint passed. A synthetic replay with the account's configured provider and real read-only knowledge passed the existing sales verifier without a handoff or customer send. Tone remains model-generated, so one replay does not guarantee every reply's phrasing.
