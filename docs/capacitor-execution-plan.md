# Capacitor mobile execution plan

15 November 2026 · Execution plan; current delivery evidence is recorded below and in the linked inventory.

Phase 1 started 16 November 2026. As of 17 November, the packaged Android emulator app supports authenticated chat/media, tracked replies/voice recording, private contact photos, Today/follow-ups and quotation PDF viewing/sharing with confirmed dispatch. Mobile source and repeatable build checks are versioned. See [feasibility inventory and verification](capacitor-phase-1.md) and [remaining work](mobile-remaining-work.md) for deployed revisions and the limits of each check. Push/Firebase, signed distribution, full role/session acceptance, real internal-recipient delivery and physical Android proof remain open. The user has an iPhone 13 and explicitly deferred iPhone work until Android is finished; no Firebase, Apple Developer or Google Play accounts exist yet.

## Outcome and architecture

Deliver Android and iOS sales companion apps with shared CRM data and reusable interface code. Start with login, Today, inbox, replies, contacts, attachments and notifications. Follow-ups and quotation viewing/sharing follow the first working slice. Administration editors and reliable background voice calling require separate later work.

Recommended architecture: retain the hosted Next.js application and backend; add a small React/Vite mobile entry point packaged by Capacitor in the same repository. Extract reusable components, types and client logic incrementally into shared packages. Keep navigation, native integrations and session persistence behind platform adapters. Validate this choice with the first end-to-end slice before moving large directories.

The current code uses cookie-based Supabase SSR in `src/lib/supabase/server.ts` and `src/middleware.ts`. `src/lib/auth/account.ts` resolves human sessions; `src/lib/auth/api-context.ts` authenticates machine API keys. Neither is automatically a mobile user-session contract. The installed Next.js static-export guide excludes cookies, request-dependent route handlers and other server functionality. Converting the entire CRM to static export is therefore inappropriate.

Do not use Capacitor's remote `server.url` setting as the production architecture: its documentation reserves it for live reload. Package the mobile interface and communicate with the hosted backend over HTTPS.

## Phase 1 — Inventory and prove feasibility

- Map each initial screen to components, Next.js imports, API calls, Supabase reads, subscriptions and permission checks. Record reusable code and required adapters.
- Verify actual deployed API/schema versions separately from local code and historical vault notes.
- Align with `docs/phone-first-operations-plan.md`: start with sales staff; worker identities and access remain a separate product decision.
- Identify actual pilot devices, supported OS versions, app identifiers, distribution route and ownership of Apple/Google developer accounts and push credentials. Confirm current SDK requirements when installing tooling.
- Create a staging tenant with synthetic contacts and messages; establish current web regression checks.
- Prove login → conversation list → open conversation on physical Android and iPhone using a packaged local interface and hosted staging API.

Exit: both devices authenticate and read authorized data; document measured reuse and remaining blockers before expanding scope.

## Phase 2 — Shared code and user authentication

- Add the mobile workspace and native projects without relocating the existing web app unnecessarily. Share pure types, validation, design tokens, translations and suitable client components first.
- Define typed API contracts with pagination, consistent errors and backwards-compatible response evolution. Reuse backend services instead of copying business rules into mobile endpoints.
- Add a mobile user-token authentication adapter that verifies Supabase access tokens server-side and resolves current membership, role and conversation access. Preserve user-scoped RLS. Never ship machine API keys, service-role credentials, Meta tokens or AI secrets.
- Integrate middleware deliberately so valid mobile tokens reach the appropriate routes; preserve existing web cookie protections. Configure exact native origins and preflight handling where needed. CORS is not authorization.
- Implement native session storage through a maintained Keychain/Keystore-backed adapter, refresh coordination, logout cleanup, account switching and revoked-membership handling. Avoid generic preferences storage for refresh tokens.
- Support recovery/invitation callbacks with validated destinations; use PKCE for applicable browser-based auth flows and verified app links where supported.

Exit: expired sessions recover, revoked users lose access, account switches clear cached data, and cross-account API/storage access fails in automated tests. Existing web login still passes.

## Phase 3 — First complete sales workflow

- Implement Today, inbox list, conversation, text reply and contact details using shared components and a mobile navigation shell.
- Centralize platform differences: API base URL, authentication, navigation, files, sharing, app lifecycle and notifications. Avoid scattered native checks throughout feature code.
- Handle safe areas, keyboard overlap, Android back, deep links, large text, screen readers and Arabic RTL. Preserve drafts when switching views or resuming the app.
- Add photo/file upload with permission-denied and retry states, existing private storage access checks, file limits and clear upload progress. Reuse server WhatsApp sending and AI draft/handoff rules.
- Add quotation viewing/sharing and follow-ups after the core inbox slice passes. Sharing a file must not claim the customer received it.

Exit: a salesperson can open an assigned conversation, reply, attach a photo and inspect the contact on both platforms in Arabic and English; the web interface shows the resulting records.

## Phase 4 — Synchronization and safe retries

- Use the database as authority. Subscribe to authorized realtime changes while active and refetch after reconnect/resume to recover missed events. Realtime alone is not a durable synchronization log.
- Deduplicate events by record ID, reconcile optimistic state and remove stale subscriptions on account changes. Test simultaneous web/mobile edits.
- Add server-enforced idempotency for retryable mutations and revision checks where needed. Persist send attempts before external side effects; reconcile uncertain provider outcomes instead of blindly sending again. Do not claim exactly-once delivery from a client request key alone.
- First release: preserve drafts and optionally bounded cached reads, clearly mark stale data, and require connectivity to send. Introduce an offline send queue only after ordering, conflict, retry and failure recovery are implemented.
- Minimize cached customer data, define expiry, protect sensitive persisted content and clear it on logout/account change.

Exit: reconnect recovers missed messages; double taps and timeouts do not produce uncontrolled duplicate sends; failed/pending/sent states are accurate.

## Phase 5 — Push notifications and native behavior

- Configure APNs for iOS and FCM for Android, device registration and token rotation. Associate tokens with authenticated users and environments; remove invalid tokens and unregister on logout.
- Create server-side notification delivery from durable events with retries and deduplication. Check current assignment and membership before dispatch; support user preferences and quiet hours.
- Default to minimal lock-screen content. A notification deep link must authenticate and reauthorize access before fetching the conversation, including after reassignment.
- Test foreground, background, terminated app, denied permission, expired login and notification taps. Treat push as a prompt to fetch authoritative state, not a guaranteed message transport.
- Evaluate voice recording and calling independently. Existing browser calling does not establish background ringing, audio routing or native call lifecycle support. Gate unsupported calling controls until physical-device validation passes.

Exit: eligible pilot users receive the correct alerts and land in authorized conversations; removed users and signed-out devices receive no newly scheduled private alerts.

## Phase 6 — Coordinated updates and release automation

| Change | Delivery |
| --- | --- |
| Messages, contacts, deals | Shared backend plus realtime/refetch |
| Compatible backend or AI behavior | Backend deployment |
| Shared interface code | Web deployment plus mobile bundle/build release |
| Native plugin, permission or SDK | New signed store build |

- Build web and mobile from the same reviewed commit. CI runs typechecking, lint, relevant tests, shared-component builds and native compilation; record commit, API compatibility and native build versions in artifacts.
- Use separate development, staging and production app IDs/configuration. Keep signing keys and service credentials in protected release storage. Version native projects and lock dependencies.
- Deploy additive schema/API changes before dependent clients. Maintain older-client compatibility for an explicit support window, measured from actual adoption. Retire fields only after supported clients no longer need them.
- Start with store-managed releases. Later, evaluate an OTA provider if update frequency warrants it; verify current Apple/Google policies, maintenance and pricing before selection.
- OTA must use signed bundles, native-runtime compatibility targeting, staging/canary channels, startup health checks and automatic rollback to a known-good bundle. Activate at a safe restart, never halfway through a reply, upload or call. Native changes still use store builds.
- Keep remote feature flags account-scoped and server-authorized. Provide a kill switch for faulty features and a useful upgrade message for unsupported clients.

Exit: release a staging change through the complete pipeline, prove the previous supported client still works, and rehearse backend/feature/bundle rollback. Store binary rollback normally requires a replacement release, so plan for that delay.

## Phase 7 — Pilot and production acceptance

- Run relevant repository checks and real-device end-to-end tests: auth expiry, access denial, cross-tenant data isolation, uploads, Arabic/English, poor network, repeated taps, reconnect, push and old-client compatibility.
- Scan distributed bundles for secrets and verify HTTPS, external navigation restrictions and private attachment access. Instrument crashes, API failures, startup time, notification delivery and send reconciliation without logging customer content or tokens.
- Distribute through TestFlight and Google Play internal testing, then pilot with a small sales group. Observe actual tasks; synthetic tests do not establish usability or successful delivery.
- Prepare store metadata, privacy disclosures, permission explanations, support contact and any required account-management behavior. Verify current distribution rules at submission.
- Expand only after no unresolved critical auth/data-loss/duplicate-send defects, successful core tasks on both platforms, demonstrated web/mobile synchronization and a documented recovery procedure.

## Suggested implementation slices

1. Architecture inventory and packaged authentication spike on both platforms.
2. Shared contracts, user-token API adapter and authorization regression tests.
3. Inbox read/reply slice with realtime recovery and safe sending.
4. Attachments, Today, contacts, follow-ups and quotation access.
5. Push registration, dispatch and authenticated deep links.
6. Release automation, compatibility tests and small-team pilot.
7. Broader distribution; optional OTA after a successful release cycle.

Estimate effort after slices 1–2 expose the actual authentication and component dependencies. Developer-account enrollment, signing access and physical-device availability are external dependencies; store review duration is not an engineering guarantee.

## References

- [Capacitor installation requirements](https://capacitorjs.com/docs/getting-started)
- [Capacitor build and sync workflow](https://capacitorjs.com/docs/basics/workflow)
- [Capacitor configuration and remote URL limitations](https://capacitorjs.com/docs/config)
- [Capacitor security guidance](https://capacitorjs.com/docs/guides/security)
- [Native push notification setup](https://capacitorjs.com/docs/apis/push-notifications)
- Installed Next.js guide: `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`.
- Project hub and linked architecture, code atlas, working guide and Jev proposal were consulted; deployment remains independently verifiable.
