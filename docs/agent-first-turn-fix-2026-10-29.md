# First-turn false handoff correction

The playground transferred after “عندكم ابواب؟”. A read-only replay reproduced it: input routing recognized a product question, DeepSeek generated an answer, and factual verification rejected both the initial and rewritten drafts. The legacy reply flow converted this verification failure into a transfer.

The account still had the old long sales prompt, no separate company facts, and advanced behavior disabled. That prompt included instructions to transfer for missing information. The first live correction separates the confirmed company facts from writing instructions and replaces the conflicting prompt. Provider, model, credentials and advanced behavior flag are preserved. The update used the current configuration timestamp to avoid overwriting a concurrent edit; its backup is private.

## Baseline code correction

Failed verification is not evidence that a customer requested a person. The baseline flow now attempts one closed-set fallback after its existing bounded rewrite. The fallback must pass the unchanged factual and legacy response checks. If it cannot pass, the reply creates internal review work with no customer text/actions and no automatic ownership change or thread pause. Explicit human requests and justified authority decisions still transfer. The final sender backstop also reviews empty/unverified-price replies instead of sending a false closing/transfer message.

The advanced flow additionally has narrow checks for comparing the wrong alternatives and repeating an explicitly supplied scope. Both use the existing violation threshold; no factual threshold was reduced. Dialogue state labels the current request and preceding assistant turn. These extra checks remain behind the existing advanced behavior switch.

## Validation

- The saved account setup reproduced the screenshot failure. Separating facts/instructions passed the exact opening on the first verification.
- After the baseline recovery correction, read-only generations using the saved DeepSeek configuration passed the exact Arabic question, an Arabic home-door paraphrase and the English equivalent. No customer messages or replay audit rows were written. Retrieval used the existing lexical fallback, avoiding calls to the depleted embedding provider.
- 1,473 ordinary tests pass; 63 live semantic checks pass. Tests explicitly retain unsafe-draft rejection, field/media restrictions and genuine human requests, while allowing a separately verified safe recovery.
- TypeScript and lint pass (existing repository lint warnings remain).

The wider advanced rollout is still **off**. A newly frozen 24-case synthetic readiness set produced 16/24 outcomes matching its initial route/nonempty-reply criterion, including seven internal reviews and three transfers (two explicit human requests, one callback request). Manual review found four nonempty replies that missed part of the request or asked an unnecessary clarification. One callback gold label was too strict, but has not been changed to inflate the score. This does not meet the usefulness target and is not a historical/live improvement measurement. The holdout was not used to tune the correction afterward.

Private replay drafts, before/after configuration, fixture hash and outputs are under `~/.local/state/wacrm/evaluations/doors-20261029/`. The live configuration correction and baseline failure/transfer distinction are separate from activation of the advanced policy.
