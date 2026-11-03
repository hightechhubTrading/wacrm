# Agent reply reliability and model recommendations — 3 November 2026

Recent read-only production diagnostics distinguished intentional stand-down (human ownership, pause, newer inbound) from failed output verification. The active account uses DeepSeek Flash, not OpenAI. Over the inspected seven-day window, 22 `reply_needs_review` events ended without a customer response. Relevance and business-fact checks rejected drafts; this does not prove every rejected draft was correct.

## Reply behavior

Baseline relevance checks now receive the current request, preceding assistant turn and conversational evidence separately from the full catalogue/knowledge dump. Factual and action checks retain their approved evidence and existing thresholds. Independent checks run concurrently. Empty question groups make no paid request. Advanced behavior remains opt-in and is not enabled by this change.

If generation times out/fails, verification exhausts its bounded recovery, or the last price/empty-answer backstop rejects a response, eligible customer threads receive a fixed receipt explaining that staff review is needed. The rejected draft, price and actions are never sent. Existing review tasks remain; provider failures now also notify staff on the baseline path. The receipt does not claim an appointment, finalized quotation, completed handoff or response deadline. It does not pause or reassign the conversation. The follow-up UI distinguishes receipt delivery from a resolved request.

Migration 096 adds a service-only atomic claim using the conversation row lock. It verifies tenant, current assignment, pause, active AI configuration, latest message being the same customer trigger, and reply cap. Claims are once per trigger and at most once per conversation/hour. A failed/uncertain receipt send retains the claim to avoid retry spam. Missing claims fail closed. Actual delivery is logged separately. No receipt follows an attempted normal customer send or handoff, because its delivery may be uncertain. Generation, language correction and repairs share a 60-second deadline, leaving room within the inbound webhook lifetime for verification and review handling.

Intentional pauses, staff ownership, automation/flow ownership, consent handling, throttles and newer messages continue to suppress automated replies. Delivery failures, exhausted caps and receipt cooldowns can still require staff action. This change is not a promise that every inbound receives an automated message.

## Model picker

Recommendations are curated for short sales/support replies, with editable model IDs and API-key validation before save. They are not an account-specific availability list or a measured cross-provider ranking. Existing saved provider/model selections are retained. New-form defaults use the recommended routine model; no live account configuration is rewritten.

| Provider  | Routine sales/support | Complex requests  | Lower-cost/high-volume  |
| --------- | --------------------- | ----------------- | ----------------------- |
| OpenAI    | `gpt-6.1-terra`       | `gpt-6.1-sol`     | `gpt-6-luna`            |
| Anthropic | `claude-sonnet-5-5`   | `claude-opus-5-5` | `claude-haiku-5-5`      |
| Google    | `gemini-3.8-flash`    | Custom ID         | `gemini-3.5-flash-lite` |
| DeepSeek  | `deepseek-flash`      | Custom ID         | Same Flash model        |

DeepSeek's retired `deepseek-v4-pro` alias currently routes to Flash; it is no longer advertised as a distinct quality upgrade. Saved aliases/custom IDs remain usable. OpenAI Terra/Luna explicitly disable reasoning for short replies; Sol uses supported low reasoning and a 4,096-token combined reasoning/output allowance. Gemini Flash uses supported low reasoning, while Flash Lite uses minimal reasoning; both have 4,096-token output headroom. Gemini 3 thinking cannot be disabled, and Flash 3.8 rejects minimal effort. Unknown/custom IDs retain the existing compatibility payload. Native tools are not advertised; current adapters request plain text and parse the app's existing markers.

Reviewed primary sources:

- [OpenAI models](https://developers.openai.com/api/docs/models), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
- [Anthropic model overview](https://platform.claude.com/docs/en/models/overview).
- [Google model catalogue](https://aistudio.google.com/docs/models), [Flash](https://aistudio.google.com/docs/models/gemini-3.8-flash), [Flash Lite](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite), [OpenAI compatibility](https://aistudio.google.com/docs/openai), [thinking levels](https://aistudio.google.com/docs/thinking#thinking-levels).
- [DeepSeek canonical model and legacy alias routing](https://www.deepseek.com/en/news/deepseek-v4-1-flash/).
- [TypeSafe API](https://docs.typesafe.ai/api.md), [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md).

## Validation and limits

- Unit/regression suite: 1,665 passed, 74 opt-in tests skipped. TypeScript and production build pass.
- Live TypeSafe synthetic sales suite: 50/50 passed. New Arabic reliability cases: 6/6 passed, including blocked invented prices/bookings. A first UPVC candidate with only a brief qualification was rejected; the passing fixture supplies useful product information. These fixtures do not establish universal calibration.
- Separate live configured-DeepSeek generation probe: two of four synthetic requests produced verified replies; one still needed review and one timed out. This is evidence that the deterministic receipt path remains necessary, not a provider-readiness pass. No customer messages or sends were used for the probe. Provider failures and review receipts are covered with synthetic transports.
- Browser checks: actual settings component, Arabic/English, mobile/desktop, saved GPT-5.4 retained, three OpenAI suggestions, custom input, viewer read-only; no API writes. Existing project components reused after 21st search; 21st review reports no findings.
- Transactional database checks (rolled back): service-only privileges, null/wrong tenant, stale trigger, changed assignment, paused thread, cap, valid claim and duplicate claim after cooldown. Migration preflight adds a null-scoped no-write RPC probe.
- OpenAI and Gemini request compatibility are checked with mocked transports and official documentation. No paid OpenAI or Gemini test is claimed.

Production rollout evidence is recorded separately after deployment. No historical customer messages are replayed or threads automatically resumed.
