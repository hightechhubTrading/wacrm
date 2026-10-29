# Agent behavior release, 29 October 2026

## Rollout status

Migrations 080 and 081 have been applied to the linked production database and recorded as timestamped migrations. The new account behavior switch defaults to **off**. Keep it off until the remaining generation and usefulness gates pass. Existing paused conversations are not resumed, existing follow-ups are not closed automatically, and catalog products are not promoted by this release.

Ten customer education guides were reviewed, approved and indexed using the existing vector/lexical retrieval. They explain product categories; they do not establish offered variants, certified performance, approved prices or available appointment slots. Confirmed company facts and reply instructions now have separate settings. The planned clean account prompt/facts have been saved privately but have not replaced the live configuration.

## Implemented behavior behind the account switch

- Answer the current request before qualification; use recent dialogue to resolve short references, ask one necessary unanswered question, and avoid default home/project qualification.
- Keep company evidence separate from style instructions. Narrow product context using retrieved source IDs and customer product names while retaining a full-catalog fallback for discovery.
- Judge factual support, dialogue quality and action provenance in separate states. Factual support remains at 0.85. Dialogue checks identify concrete violations at 0.90; this is a different question/polarity, recorded in audit metadata, rather than a reduction in factual support requirements.
- Use bounded, reverified recovery. A rejected or unavailable draft creates internal review work without claiming a transfer or disabling the thread. Explicit human requests and genuine authority decisions retain handoff routing.
- If generation fails, select only from fixed wording or approved source excerpts, then independently verify the selection. A short provider circuit prevents repeated requests to the same unavailable key. No new generative provider is configured.
- Track up to two requested attachments with durable source/asset identity, atomic claims and provider acceptance IDs. An uncertain transport result is reviewed rather than blindly retried. Deleted assets leave an audit snapshot.
- Record deduplicated knowledge-gap questions for staff without overwriting answers. Record stage timings, source message IDs and a configuration hash without copying credentials or customer text into diagnostics.

The staff follow-up panel exposes review reasons, handoff summaries, media outcomes and later human replies. A later human reply is a prompt to review completion, not proof that a task was completed. The optional `AI_WORK_POLL_ENABLED=true` server worker runs staff reminders and recovers interrupted attachment actions; it never sends customer messages. Deployment candidate containers explicitly disable this worker and Meta CAPI.

## Validation and limitations

- 1,461 ordinary tests pass; TypeScript, ESLint and production webpack build pass.
- The 60 live TypeSafe synthetic checks pass, covering English/Arabic, human requests, unsupported claims, attachments and safe recovery. Negative tests verify rejection of the original unsafe draft; a separately verified clarification is allowed.
- Isolated PostgreSQL-compatible validation covers migration defaults, tenant checks, member/anonymous denial, atomic action claiming, duplicate suppression and audit survival after asset deletion. Deployment database probe tests pass.
- Browser checks cover saving separate facts/instructions, credential preservation, viewer restrictions and English/Arabic mobile layouts in light/dark modes. The preview imports the production dashboard stylesheet.

The private history set contains 134 turns, split by conversation/duplicate message group into 87 development and 47 holdout turns. The exporter was corrected to exclude historical bot replies recorded before the event timestamp and to label transcribed speech like production. All results from the earlier fixtures are invalidated; the private manifest retains both hashes.

The reply provider exhausted its credits during corrected development evaluation. No complete free-form generation benchmark or post-release live improvement is established. Generation evaluations now have explicit case/call budgets. No further generation calls were made after the outage was identified.

The fallback-only development run produced 85/87 verified continuations before wording review. Three reviewed cases showed that verification alone overstates usefulness; selection was tightened on development examples. The untouched fallback-only holdout produced **42/47 verified continuations (89.4%)**, with additional unnecessary clarifications found on manual review. This does **not** meet the 90% usefulness target. These runs used TypeSafe decisions and lexical retrieval, without generative/embedding provider calls or customer/database writes. Do not present these numbers as live conversion or false-handoff improvements.

## Finish activation

Restore the configured provider balance, then use a newly frozen, independently reviewed holdout to validate full generation, recovery, usefulness and latency. Do not tune against the already exposed holdout. Apply the clean prompt and confirmed facts with an optimistic configuration timestamp check. Enable the account switch only after those gates pass, monitor internal-review/transfer reasons and provider errors, and retain a quick switch-off rollback. Enabling the switch during a provider outage is not approved by these results.

Private customer fixtures, provider configuration, migration backups and release evidence remain outside Git under `~/.local/state/wacrm/`. No customer messages were sent by the audit, evaluation or migration tools.
