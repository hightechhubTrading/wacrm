# AI reliability rollout — 3 November 2026

The live application at `https://wacrm.srv1795091.hstgr.cloud` runs `b0b5b937a471cdef07f394e623859367f94f00a3`. This includes reply recovery and model recommendations from `e4a45fd`, plus supported Gemini reasoning budgets and retained advanced-mode staff notifications.

Migration 096 (`ai_review_receipt`) is recorded as `20261103092526`. Its claims are executable by the service role; anonymous and authenticated roles cannot execute them. Transactional claim checks were rolled back. The null-scoped deployment probe returns false without writing anything.

Both the candidate and promoted app passed startup, authentication and Chromium PDF checks. Public verification returned login 200, protected pages redirect 307, and protected AI configuration/follow-up/quotation APIs 401 when signed out. The runtime revision exactly matches the release. Candidate containers and temporary candidate environment files are gone; private task/company evidence is absent from the image.

The live account remains on `deepseek` / `deepseek-flash`, active with auto-reply enabled, unlimited per-conversation replies, after-hours takeover enabled, business-hours pause disabled, and advanced behavior disabled. The provider/model and all inspected reply settings match the pre-change snapshot. No account configuration was rewritten or historical customer messages replayed.

Validation: 1,665 regression tests passed, 74 opt-in tests skipped; TypeScript, production builds, targeted ESLint, 35 deployment-preflight tests, Arabic/English mobile/desktop settings checks and 21st review passed. Live synthetic TypeSafe evaluation passed 50 existing sales cases and six new Arabic cases. The separate DeepSeek probe still encountered one rejected reply and one timeout; reviewed wording and provider output are not universally reliable, which is why the fixed receipt and staff task remain necessary. OpenAI/Gemini payload compatibility was tested with mocked transports, not paid live calls.

Temporary SSH access was revoked. A fresh connection with that key was rejected with `Permission denied`, and both local key files were deleted. Rollback remains available as `wacrm:rollback` through the established deployment process.

See [implementation and validation limits](ai-reliability-2026-11-03.md).
