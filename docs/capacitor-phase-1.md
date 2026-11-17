# Capacitor Phase 1 — feasibility inventory

16 November 2026. Phase 1 is in progress. This record distinguishes inspected local code from deployed behavior and physical-device proof.

## Current findings

### Android tooling update, 16 November

Android Studio and API 37 ARM64 emulator are now installed. SDK resides at `/Volumes/2TB M2/AndroidSdk`, linked from `~/Library/Android/sdk`. The M2 is ExFAT. Moving the AVD directly there caused a startup stall observed in `filelock_create_timeout`, with no ADB connection. The AVD was copied into an APFS sparsebundle on that same SSD (`/Volumes/2TB M2/AndroidAVD-Mac.sparsebundle`), mounted at `/Volumes/AndroidAVD`, and its registry updated. Original AVD copies were retained. No drive formatting occurred.

The virtual device now uses four CPU cores. A cold startup with `-no-snapshot` completed: `adb devices -l` reports `emulator-5554 device`, and `adb shell getprop sys.boot_completed` returned `1`. This proves emulator boot, not CRM or Capacitor execution. After restarting the Mac or disconnecting the M2, mount the sparsebundle again before launching this AVD. Its 40 GB capacity is a growth limit, not an immediate 40 GB allocation. Keep the emulator stopped before ejecting the mounted image or SSD.

Earlier discovery below records the initial machine state; this update supersedes its missing Android tooling finding.

The user has an iPhone 13. Its iOS version is not yet recorded. No Android phone is available; an emulator can cover initial development, but the plan's physical Android acceptance remains pending. No separate staging environment is known to the user.

Local readiness checks found Node 26.8.1 and Supabase CLI. The selected Apple developer directory is `/Library/Developer/CommandLineTools`; full Xcode and Android Studio were not found in `/Applications`. Android `adb` is not on PATH or at the standard user SDK path. Docker is not on PATH, so a local Supabase stack cannot currently be started through its usual Docker workflow. These are discovery results, not proof that no alternate installation exists.

Capacitor's current v8 environment guide specifies Node 22+ and Xcode 26+. Verify Android SDK and Java requirements for the installed Capacitor version when provisioning. [Official environment guide](https://capacitorjs.com/docs/getting-started/environment-setup).

## Screen and dependency map

| Initial workflow | Current implementation | Reuse and mobile adaptation |
| --- | --- | --- |
| Login/account | `src/hooks/use-auth.tsx`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/auth/account.ts`, `src/middleware.ts` | Separate mobile Supabase client/session storage; server human-token adapter needed for cookie-protected CRM APIs. Keep existing account/role checks. |
| Today | `src/components/dashboard/agenda.tsx`, `src/lib/dashboard/agenda.ts`, `src/lib/dashboard/queries.ts` | Query functions accept a Supabase client and are candidates for reuse. Adapt `next/link`, translations and the relative follow-up mutation endpoint. Verify deployed `sales_today_replies` RPC. |
| Inbox list | `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/conversation-list.tsx`, `src/hooks/use-inbox-list.ts`, `src/hooks/use-inbox-query.ts` | Extract reusable list/state logic; replace Next navigation, browser client singleton and environment configuration. Do not move the entire screen before proving the dependency boundary. |
| Conversation/history | `src/components/inbox/message-thread.tsx`, `src/lib/inbox/message-history.ts`, `src/lib/inbox/thread-previews.ts` | History merging and client-injected reads are reusable. Thread UI needs navigation, locale, auth, composer/media and calling adapters. |
| Realtime/resume | `src/hooks/use-realtime.ts`, inbox page resync handlers | Hook currently creates the web client directly. Inject mobile client, resync on resume, clean up subscriptions on account change, test RLS with mobile sessions. |
| Reply/retry | `src/lib/inbox/send-outcome.ts`, `src/lib/whatsapp/send-operations.ts`, `/api/whatsapp/send` | Existing operation IDs and uncertain-outcome reconciliation must be preserved. Adapt relative URLs and cookie auth; do not implement another sending engine. |
| Contacts | `src/app/(dashboard)/contacts/page.tsx`, `src/components/contacts/contact-detail-view.tsx` | Direct Supabase queries and shared types can be adapted; audit nested component dependencies, mutations, private attachments and role gates before sharing UI. |
| Follow-ups | `src/components/dashboard/agenda.tsx`, `/api/ai/followups/[conversationId]` | Reads use Supabase; action endpoint needs verified mobile user-token authentication. |
| Quotations/files | `src/components/quotations/`, `src/app/api/` quotation routes | Later slice: inventory download/PDF URLs and cookie requirements before native sharing. Keep private files and authorization server-controlled. |

Additional pure reuse candidates: `src/types`, `src/lib/inbox/conversations.ts`, `message-groups.ts`, `query-state.ts`, `triage.ts`, `src/lib/auth/roles.ts` and business-time helpers. This is a candidate inventory, not a measured reuse percentage or a completed transitive dependency audit.

The public `/api/v1` uses machine API keys (`src/lib/auth/api-context.ts`). Embedding those in the mobile app would not provide individual salesperson authorization. Use user sessions instead.

## Test environment and seeded scenario

Use a separate hosted Supabase test project, or a local Supabase stack once Docker is available. A test copy contains fake people and messages; never seed fake records into the live company account or copy real customer records unnecessarily. A second tenant in production is not equivalent to deployment isolation.

Before provisioning hosted resources, establish project ownership, region and any cost. No test project or database records have been created by this phase yet. Do not infer schema deployment from migration filenames or historical notes.

Required fixtures:

1. A sales user in synthetic account A, an accessible assigned conversation and at least one synthetic message.
2. A second synthetic account B with a known existing conversation/message inaccessible to the first user.
3. For broader assignment checks: a second agent in A and a known conversation the first agent cannot access under the intended policy.

Verify fixture existence separately as the fixture owner. An arbitrary nonexistent UUID returning no rows does not prove isolation. Check current local migration prerequisites, then apply the required schema to the test environment in order; record the actual remote migration history. Provision test auth users through a server/admin setup path, never with a bundled service-role key.

## Read-only hosted-session probe

`scripts/check-mobile-staging.mjs` tests password login, expected membership, bounded conversation reads, seeded message history, known-forbidden conversation/message reads and session refresh. It uses an in-memory user client, does not read `.env.local`, performs no business-data writes and logs no tokens, customer content or raw provider errors. Authentication still creates/refreshes/revokes this test session on the auth server.

Supply these through a private, ignored environment file outside the repository or the process environment:

```dotenv
MOBILE_PROBE_TARGET=staging
STAGING_SUPABASE_URL=https://YOUR-TEST-PROJECT.supabase.co
STAGING_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLIC-TEST-KEY
STAGING_USER_EMAIL=YOUR-SYNTHETIC-USER
STAGING_USER_PASSWORD=YOUR-TEST-PASSWORD
STAGING_ACCOUNT_ID=UUID-OF-ACCOUNT-A
STAGING_CONVERSATION_ID=UUID-OF-ACCESSIBLE-SEEDED-CONVERSATION
STAGING_FORBIDDEN_CONVERSATION_ID=UUID-OF-KNOWN-EXISTING-FORBIDDEN-CONVERSATION
```

Run `node --env-file=/absolute/private/path/mobile-staging.env scripts/check-mobile-staging.mjs` from the repository. Use only synthetic test credentials. The `staging` flag is an operator declaration, not independent proof that a project is isolated; verify the URL before running.

A passing Node probe does not prove native CORS, Keychain persistence, WebView routing, secure native login, all RLS policies or mobile authorization of Next.js endpoints. Test those in the packaged app in the next slice. Password auth must be enabled for the synthetic test user; do not change production authentication settings to accommodate this probe.

## Next implementation slice and acceptance

1. Prepare Xcode and an iPhone development build path; confirm iOS version and signing availability. Add Android Studio/emulator for parallel platform checks when available.
2. Establish isolated test backend/fixtures and run the probe. Record migration history and test account role without committing credentials.
3. Create a minimal packaged React/Vite/Capacitor entry point, temporary development app identifiers and a memory-only session spike. No production remote `server.url` wrapper.
4. Demonstrate login → list → conversation on iPhone 13; then prove session storage, lifecycle, membership revocation and token-authenticated Next API access before expanding to replies.
5. Run the equivalent flow on Android emulator, and record real Android acceptance as pending until a physical device is available.

Phase 1 is complete only after the agreed device proof and test-environment verification. Local helper tests or synthetic browser fixtures cannot substitute for this evidence.

## Verification log

### Packaged Android demo, 16 November

`mobile/` now contains an isolated React/Vite/Capacitor development app (`com.hightechhub.crm.demo`). It packages the interface locally and shows two synthetic, read-only conversations; there is no sign-in, real customer data, sending or backend connection. The demo uses the CRM light palette as a reference; production components have not yet been extracted into shared packages. The 21st catalog search returned HTTP 401; its review noted a hardcoded-color advisory. Native status-bar/safe-area placement was visually checked.

Verified:

- Mobile TypeScript/Vite build, root TypeScript check and focused ESLint passed.
- Browser flow checks passed: entry, search/empty state, English/Arabic history, navigation, narrow viewport, no runtime errors or external requests.
- Existing inbox regression: 3 test files, 14 tests passed.
- Android debug build succeeded using Gradle 8.14.3, JDK 21 and SDK 36. JDK 21 and Gradle caches reside on the M2-backed APFS image. SDK 36 and build tools were installed on M2. The generated Gradle wrapper was restored after an IDE-side upgrade to 9.7.1; keep its compatible version for this spike.
- APK installed and launched on API 37 emulator. Playwright connected to the actual Android WebView and verified both message histories, search, Android hardware Back, in-app navigation and no horizontal overflow. Temporary debugging forward removed afterward.
- Emulator screenshot: `/tmp/wacrm-android-demo.png`. Debug APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (ignored build artifact).

The app is left open on the demo inbox. Next: isolated staging and mobile user-session integration; Phase 1 authentication/RLS proof and physical-device acceptance are still pending. Emulator success is not physical-device validation.

Local source inventory and tool discovery completed. Regression and probe checks are recorded below after execution. No claim is made about current production API/schema revision, native compilation, live login or physical-device behavior.

- `node --check scripts/check-mobile-staging.mjs`: passed.
- Running the probe without configuration: exited with status 1 and listed missing variable names before any network request, as intended. Hosted probe not run.
- Focused Vitest baseline: 6 files / 59 tests passed (`conversations`, `message-history`, `thread-previews`, `send-outcome`, `auth/account`, `auth/roles`). This is unit regression evidence, not browser or RLS deployment evidence.
- Existing synthetic browser harness: `scripts/check-inbox-responsive.mjs` and `scripts/performance/supabase-fixture.mjs` can establish a later viewport baseline without live customer records. Not rerun during this inventory.
- `git diff --check`: passed for tracked changes; unrelated working-tree edits were preserved.

### Existing Supabase read-only integration, 16 November

The user explicitly approved using the current Supabase project. This supersedes the separate-staging prerequisite for this read-only slice. `mobile/src/client.ts` uses the existing public project URL and anon/publishable key, memory-only sessions, refresh and a fetch guard blocking database writes. Only auth token/logout POST operations and GET requests to that project are used; no service-role/WhatsApp/AI secrets are bundled. The CSP permits that project's HTTPS origin. Local public configuration is ignored by Git.

The installed Android build now opens sign-in; successful login loads current membership, the latest 100 visible conversations and the latest 50 messages in a selected conversation. Reads recheck membership/visibility, are bounded, and discard stale responses on navigation/sign-out. Resume and manual refresh reload data. Customer text is rendered as text, not HTML. Media is represented by a label without fetching private attachments. Sign-out revokes only the local session, clears UI data, and avoids signing out the website. Sessions/passwords are not persisted by the app.

Validation: mobile/root TypeScript, focused lint, mobile build/sync, Gradle debug build, installation and native sign-in DOM check passed. Mocked browser tests cover invalid credentials, password clearing, conversation/history reads, customer direction, missing membership denial, no database mutation requests, sign-out cleanup and no localStorage session. Existing demo browser regression passed. A scan found no private root environment values in the web bundle. Live anonymous conversation/message queries returned no records; this is not proof of all authenticated tenant/assignment policies.

No real user credentials were available or entered. Live authenticated sign-in, MFA requirements, tenant/assignment denial, expired/revoked sessions and physical-device testing remain pending. The emulator is left on sign-in for the user to enter their existing CRM credentials directly. Phase 1 remains in progress. Secure session persistence, full pagination, live realtime and sending are subsequent work.

### User-entered live login verified, 16 November

The user signed in directly in the Android emulator. Subsequent read-only WebView checks confirmed authenticated UI, 100 visible conversations (the configured page cap), opening a conversation with four messages, returning to the inbox and refreshing successfully. No loading errors or horizontal overflow were observed, and localStorage remained empty. Credentials, session tokens and customer content were neither extracted nor logged. The app was left signed in on the inbox; temporary debugging port forwarding was removed.

This supersedes the pending basic-login/history check above. Cross-tenant/assignment denial for multiple roles, token expiry/revocation and physical-device validation are still unverified; successful access for this user alone does not prove all permission boundaries.

### Secure Android session storage and boundary checks, 16 November

Added an app-local `SecureSession` Capacitor plugin. Session ciphertext is stored in private SharedPreferences; AES-256-GCM key material stays in Android Keystore. Each write uses a fresh IV, and authenticated additional data binds ciphertext to its storage key. Invalid ciphertext is removed and requires sign-in. Native storage exposes only the Supabase session-related keys. Browser preview remains memory-only. App backup/cloud transfer are disabled/excluded and Capacitor logging is disabled to prevent bridge payload logging.

The UI restores Supabase sessions on startup and still revalidates the user and current membership before reading data. Logout clears persisted session-related keys and reloads SDK memory even if network revocation fails; it cannot guarantee server revocation while offline. Failure to remove native storage is surfaced to the user. No password is saved. Cross-account/session state is not cached on disk.

Verification:
- Two Android instrumentation tests passed using a synthetic, separate storage namespace: encryption round-trip across instances, randomized ciphertext, removal, tamper rejection and storage-key/AAD binding.
- A synthetic plugin value survived a full native app process restart; deletion returned null, and WebView localStorage remained empty. This validates the storage bridge/process path without exporting a real session token.
- Browser mocked login/history/logout and membership-denial regression passed; added conversation-access-removal refresh coverage, which clears previously visible history.
- A GET-only probe in the user's previously signed-in session returned no conversations for `account_id != current account`; no credentials, account IDs or customer data were logged or retained. This is evidence for the current session; known foreign fixtures and a full role/assignment matrix remain unverified.
- App-scoped debug and instrumentation build tasks passed. A blanket dependency instrumentation build exposed a Kotlin duplicate-class conflict in dependency test code; production app and its scoped tests are unaffected.

The prior memory-only session cannot migrate automatically across an app replacement. The user must sign in once in the updated build before real-account restore/refresh/revocation can be verified. Physical-device and multi-role RLS validation remain open; the app remains read-only.

### Real-session restart verification, 16 November

After the user signed in directly in the updated app, a full Android force-stop and relaunch restored authenticated access automatically. The restarted process loaded 100 conversations without errors, and manual inbox refresh succeeded. WebView localStorage remained empty before and after restart. Only UI state/counts were inspected; no password, token or customer message content was extracted or logged. The app remains signed in on the inbox, and temporary debugging forwarding was removed. This verifies real-session restoration across process death on this emulator; server token expiry, revocation, other roles and physical devices remain separate checks.

### Automatic updates and recovery, 16 November

The user kept the inbox limit at 100 and authorized the remaining automatic-update/recovery work. Added account-filtered conversation subscriptions and selected-conversation message subscriptions in `mobile/src/use-live-updates.ts`. Events only trigger bounded, RLS-authorized refetches; no event payload is rendered directly. A 350 ms coalescing timer handles event bursts. A 30-second foreground fallback covers missed events, deletes and access changes that may no longer be visible to realtime. The selected thread remains limited to 50 messages.

Channels stop in the background and on sign-out. Online/resume/subscription recovery schedules fresh reads. Unique channel topics prevent reusing an old channel while unsubscribe is in flight; disposed/generation guards reject stale callbacks. Network status is visible. Reads verify current user and membership; scope changes clear prior data, removed conversation access clears history, and invalid authentication removes saved session-related keys and returns to sign-in. Transient connection failures do not discard saved sessions. CSP now allows only the configured project's HTTPS and WSS origins.

Validation passed:
- Browser realtime fixture (no external WebSocket): message-event burst coalescing, no duplicate displayed history, 30-second polling recovery without an event, offline/online recovery, membership denial, removed conversation access, invalid authentication cleanup, logout and strict 100/50 query limits.
- Existing demo regression, root/mobile TypeScript, focused ESLint, web build/sync and Android debug build.
- Installed updated APK restored the real user session and displayed 100 conversations with a live Supabase subscription.
- CDP transport outage in the actual Android WebView followed by reconnection recovered authenticated inbox data without errors. Actual Android Home/background followed by foreground resume rejoined realtime and loaded the inbox. localStorage stayed empty. Connection recovery tests waited for authorized reads to complete, not merely socket reconnection.

No business records were created/changed and no customer messages were sent to test realtime. Real mutation-event delivery is covered synthetically; live subscription and transport/lifecycle recovery are verified against the current backend. Other-role/cross-tenant fixture matrices, server-side revocation cases and physical-device validation remain open. Sending replies remains a subsequent feature. The emulator is left signed in on the inbox; temporary debugging forwards and network emulation were removed.

### Text-reply implementation prepared, 16 November — backend rollout pending

The user requested the next feature. Text replies now reuse `src/lib/inbox/send-outcome.ts` and the established WhatsApp send engine/operation ledger. The shared browser helper accepts an optional transport/endpoint while retaining existing web defaults. `src/lib/supabase/request.ts` preserves cookie auth for the website and uses a public-key, non-persistent, bearer-authenticated user/RLS client for native requests. Supabase Auth validates the bearer; no token claims are trusted without verification.

New `/api/mobile/messages` exposes GET capabilities/reconciliation, POST tracked text replies, and restricted native preflight. It requires bearer user authentication, allows only `https://localhost` as a browser origin, returns no-store responses, requires operation/conversation IDs, and accepts only non-empty text up to 4096 characters. Actual send/reconciliation delegate to existing route functions, retaining role, account, conversation RLS, rate limits and the send ledger. Supabase direct database writes remain blocked in mobile. The new origin/public API URL comes from the existing public site configuration; no private credentials were bundled.

The composer checks server capabilities before enabling Send. Double taps share a lock; operation IDs are generated once. The pending operation is encrypted through the existing Android Keystore plugin before POST. Unknown results keep the draft locked and offer GET reconciliation instead of automatically resending. Rejected sends retain text; accepted sends clear pending state and refetch history. Pending operations are scoped to the signing-in user/account, removed on sign-out/session invalidation and not an offline send queue. Browser preview pending state is memory-only. Clearing a session removes pending metadata; users should verify history before manually recreating any formerly uncertain reply.

Verification: 21 focused tests passed across the request adapter (including actual Supabase SDK auth dispatch with synthetic HTTP), mobile endpoint, existing WhatsApp route and shared send helper. Added viewer and RLS-hidden-conversation rejection tests before provider calls. Mocked composer tests passed for double click/one POST, accepted/rejected/unknown outcomes, preserved text and GET-only reconciliation using the same operation ID. Login/realtime regressions, TypeScript, focused ESLint, mobile web/native builds and Next.js production build passed.

The updated Android APK is installed. Native verification confirmed the composer opens and Send is disabled against the current server. No real send POST or customer message was issued. Backend changes have not been deployed. The next rollout must include the new route/helper, shared send route/helper changes and compatible existing ledger schema, preserving unrelated local edits. No new migration was introduced by this slice. Verify the deployed send-operation ledger before enabling a pilot. After deployment, first test with an explicitly identified internal WhatsApp contact; verify both the ledger and provider/customer outcome before broader use. Store distribution is not part of this development build.

### Authorized backend deployment — 16 November 2026

The user authorized deployment provided existing CRM behavior was preserved. Backend-only revision `5e498dd03300b40f65485602f2df0598427a7138` is now live on the existing Hostinger VPS. The scoped release contains six backend/test files and is a direct successor to the prior production revision `3ef075fa638b2430ede4348af318480647c84035`; mobile source and unrelated local edits were excluded. The deployment branch and local branch metadata were fast-forwarded without replacing working files.

Exact isolated source verification passed **1,760 tests** (74 skipped), plus TypeScript. The established resource-limited updater built the exact GitHub revision, checked the unrouted candidate's database readiness/PDF/auth, applied the active-call gate and promoted the image. No new database migration was needed. Existing server-owned environment, routing, calls and cookie-session behavior were preserved; the native adapter uses user bearer tokens alongside that cookie path.

Post-promotion checks passed: public login 200, protected inbox 307, unauthenticated web send/calls 401, unauthenticated mobile API 401, native CORS preflight 204 with the exact allowed origin, invalid bearer denied 401, exact running revision and container health. The actual signed-in Android app received protocol 1 / textReplies true and displayed an empty composer. No real send request/customer message was issued.

Rollback image `wacrm:rollback` retains the previous image (`sha256:e2e2da6519186af0cbba6c74ca53840c37337bdd9728fcc6008c29cc3c048fc2`). Server deployment evidence is under `/docker/wacrm/backups/mobile-api-20261116/`. Candidate containers and temporary candidate environment files were removed. The temporary deployment SSH key was removed while preserving other keys, a fresh SSH attempt was denied, and local temporary key files were deleted.

The emulator is left signed in on the inbox, with no drafted message. First real provider delivery should be tested with a user-selected internal WhatsApp contact before broader use. This rollout enables mobile text replies; it does not establish physical-device or full multi-role production validation.

### User-initiated send observed — 16 November

After the user reported completion of their test, read-only Android UI inspection found `Reply accepted by WhatsApp.`, an empty draft, no unresolved-status button, no errors and an active realtime connection. Conversation history had reloaded within its 50-message cap. Neither recipient nor message text was inspected/logged. This confirms the app's provider-acceptance outcome for the user's send; recipient delivery/read acknowledgement was not independently verified. No additional message was sent by the agent.

### Mobile delivery/read indicators — 16 November 2026

Added `mobile/src/delivery-status.tsx` and the persisted `messages.status` field to the existing RLS-scoped history query. Outgoing agent/bot messages now display Sending, Sent, Delivered, Read or Failed, with accessible descriptions. Sent explicitly means WhatsApp acceptance, not confirmed recipient delivery. Unknown/missing statuses display Status unavailable; incoming customer messages do not receive outbound receipt labels. No client-side inference promotes delivery/read state and no automatic resend is introduced. Status updates flow through the existing realtime invalidation and fallback reads.

Validation passed: mobile build/sync, focused ESLint, root TypeScript, mocked status transitions including future/unknown status, incoming-message exclusion, existing auth/realtime and send regressions, and Android debug build. Installed the APK in the running emulator. Read-only native inspection found 11 messages with three outgoing receipt labels, all recorded as Read, zero labels on incoming messages, no horizontal overflow and no load errors. Neither recipient nor message text was logged. No new messages were sent. This was a mobile-only update; the deployed backend revision remains unchanged. The app is left open in the checked conversation.


### Mobile inbox and conversation UI — 16 November 2026

Implemented the signed-in workspace in `mobile/src/workspace-ui.tsx` with CRM warm surfaces and purple accents, Lucide controls and locally bundled Tajawal for Arabic. Search, All/Unread/Assigned to me filters, initials, recorded unread badges and message previews make the existing 100-conversation window easier to navigate. Filters and inbox scroll position survive conversation navigation. Thread history remains capped at 50 messages, groups dates in Qatar time and keeps stored delivery/read semantics.

The compact, growing reply field is outside the scrolling transcript. Drafts survive navigation in a bounded, memory-only map scoped to user/account/conversation and clear on logout or accepted send. Existing encrypted pending-operation storage, capability checks, idempotent sends and uncertain-status reconciliation remain in place. New messages auto-scroll only near the bottom; otherwise a jump control preserves the reading position. Opening a conversation does not mark it read: badges reflect existing backend counts.

The shell owns safe-area padding using Capacitor-injected CSS variables with standard environment fallbacks. `adjustResize` plus viewport-height updates handle the Android software keyboard. Native validation on API 37 confirmed viewport reduction from 914 to 578 CSS pixels with an expanded keyboard; the empty reply field and Send button ended at 566px, with no horizontal overflow. Gboard initially showed a minimized hardware-keyboard toolbar with zero IME height; restarting its process allowed the real expanded-keyboard check. The emulator hardware-keyboard preference was restored afterward. The app is left signed in on the 100-row inbox, with no draft or debugging forward.

Validation passed: mobile TypeScript/Vite build and Capacitor sync, focused ESLint, root TypeScript, synthetic auth/realtime, send, demo and new UI browser checks, plus Android debug build/install. UI fixtures cover 320/390/430px widths, search/filters, filter and scroll restoration, draft preservation, new-message jump behavior and reduced viewport composer visibility. Screenshots under `/tmp/wacrm-mobile-ui/` use synthetic records. No live customer messages or backend changes were made for this UI work. The deployed backend remains revision `5e498dd03300b40f65485602f2df0598427a7138`. Physical-device validation remains outstanding.

The 21st catalog request returned HTTP 401, so implementation followed the existing local CRM design context. `21st review` reported only centralized palette color advisories. To relieve the full ExFAT project disk, mobile dependencies now live under `/Volumes/AndroidAVD/mobile-dependencies/node_modules` on the M2 APFS image, linked from `mobile/node_modules`; manifests and portable setup instructions remain in the repository. No dependency or credential directories are intended for source control.


### Photo/document viewing prepared — backend rollout pending, 16 November 2026

User requested photo and document viewing after confirming keyboard/Arabic input. Added on-demand attachment cards and a full-screen, accessible dialog to mobile conversations. Photos support zoom and pan; PDFs render locally with lazy-loaded PDF.js 6.5.438, a bundled worker/fonts/CMaps, page navigation, zoom, and extracted page text. The Android Back handler closes the dialog before leaving the conversation. Loading/error/retry, missing attachments and a 16 MB viewing ceiling are explicit. Media blobs are aborted/revoked on closure. Unsupported document previews can open in a compatible installed Android app, or download in browser preview. No upload/sending feature was added.

Prepared `src/app/api/mobile/media/[messageId]/route.ts` plus tests. It requires verified bearer auth, an account profile and current RLS-visible message ID; clients cannot supply arbitrary download URLs. Meta media uses the caller account's server-held credentials. Outbound media is restricted to HTTPS public paths in known buckets on the configured Supabase origin, with no redirects or forwarded bearer tokens. Both download paths enforce 16 MB limits. Responses use private/no-store, attachment disposition, nosniff and exact native-origin CORS. Existing cookie-authenticated website routes are unchanged; no schema migration is needed.

`AttachmentFilesPlugin` writes only an explicitly opened document to a dedicated private cache directory, grants a read-only FileProvider URI to a compatible viewer, and revokes/deletes the previous file on next open, app startup or sign-out. MIME/size validation rejects arbitrary executable/HTML formats. FileProvider was narrowed to this subdirectory. Browser/native WebView content stays transient; an external app may retain a user-opened file independently.

Verification passed: 16 new endpoint tests (26 with existing mobile-message and website-media suites), focused lint, root/mobile TypeScript, Next production build, Vite build/sync, all five synthetic mobile browser checks, 21st UI review (zero findings), Android debug build/install. Native fixtures verified photo decode/zoom, actual two-page PDF rendering/text, fallback/retry, hardware Back preserving the chat, absent Word handler reporting, and launching the installed Android PDF viewer through a content URI. The PDF activity assertion was corrected to Android 17's `topResumedActivity` field. Temporary file/URI state was then cleared, network fixtures/forward removed and the real 100-row inbox restored. No real messages were sent or customer attachments downloaded for validation. The software keyboard remains enabled as requested by the user.

The new app is installed. The attachment endpoint is NOT deployed yet; the live backend remains revision `5e498dd03300b40f65485602f2df0598427a7138`. Live attachment viewing depends on that backend rollout, followed by a read-only authorized attachment smoke check. Office documents require a compatible viewer; the emulator has a PDF viewer but no Word handler. Existing public-storage message sources outside the configured allowlist are intentionally reported unsupported. Physical-device checks remain outstanding.


### Attachment endpoint deployed — 16 November 2026

The user explicitly approved the live rollout. Backend-only revision `20b3a27a113581d5ed65e34c1c6be13e37f2315c` is now deployed on Hostinger, directly after `5e498dd03300b40f65485602f2df0598427a7138`. The release contains only the new mobile media route and its 16 tests; unrelated workspace/mobile changes were excluded. Full isolated verification passed 1,776 tests (74 skipped) and TypeScript. The previous turn also passed Next production build, mobile build/sync and Android install/viewer checks.

The established updater built the exact GitHub revision using the resource-limited builder, passed database readiness, candidate login/authentication/PDF, active-call gate, live health and public login checks, and returned exit 0. No migration was applied. New runtime image is `sha256:4380a1d6c53003ef57f99b2817b89f926b2b85c903a6b11f0c84cd493198df5d`. `wacrm:rollback` retains the immediately previous text-reply image `sha256:e7566f3043726c1b5e6aaad27fdffbbb7dc5f3708e3b5b281936b1b2ba82578d`.

Post-release checks: public login 200; protected inbox 307; unauthenticated website send/calls, mobile messages and media 401; exact native-origin media preflight 204; foreign origin 403; invalid bearer 401. Through the existing signed-in Android session, a live JPEG returned 200 (72,068 bytes) and decoded successfully; a live PDF returned 200 (31,299 bytes) with a valid PDF signature. Both responses were no-store. Existing text reply capability remained enabled. No customer content, recipient names, IDs, credentials or downloaded files were logged or retained, and no messages were sent. The inbox still held 100 loaded conversations; its retained two-character search showed six matching rows. A count assertion was corrected to distinguish the open conversation/filtered rows from loaded inbox capacity.

Server evidence is in `/docker/wacrm/backups/mobile-media-20261116/`, including previous revision/image, updater log, exit code and verification JSON. Candidate containers/environment files were removed and the builder stopped. The temporary deployment SSH key was removed while preserving the existing key; a fresh authentication attempt was denied and local temporary keys deleted. The native debugging forward and temporary attachment probe state were removed. The app remains signed in on the inbox with its existing search retained. Live attachment viewing is now enabled; physical-device and full multi-role pilot coverage remain outstanding.


### Voice playback and tracked photo/file replies — live, 16 November 2026

After the user requested voice playback and photo/file sending, extended the existing attachment dialog to incoming audio and added a paperclip/local attachment preview to the composer. The native audio player supports play/pause and seeking and explicitly stops/releases audio on close. Ogg/Opus is verified; other codecs depend on device support. Outbound JPEG/PNG photos use a 5 MB limit; PDF, supported Office and UTF-8 text documents use the existing 16 MB bucket ceiling. Optional captions are capped at 1024 characters. Recording/sending voice, video and unsupported formats remain outside this slice.

Added shared pure file-type definitions plus `POST /api/mobile/uploads`. It checks exact-origin CORS, verified bearer auth, account/agent role, per-user rate budget, current conversation RLS, bounded multipart size, allowed MIME/extension and signature before using caller-owned storage RLS. Randomized paths include account and conversation IDs in the existing public chat-media bucket. The mobile message adapter advertises mediaReplies under protocol 1 and verifies stored MIME/size plus account/conversation-bound URLs, then delegates tracked sends to the existing engine. Existing website send behavior and database schema were unchanged.

The composer uploads only after explicit Send. It stores pending media metadata in the existing encrypted vault before tracked transport; uncertain sends keep the same operation ID and require reconciliation. A global in-flight guard and pending-vault recheck prevent a second send after navigating during a slow upload. Generation/user checks stop stale session work, and operation draft versions preserve a newer local draft when an older send resolves. Rejected sends retain attachments and can reuse completed uploads. File bytes remain local to the current composer until upload; pre-send navigation does not persist a selected local file. Uploaded but ultimately unreferenced objects can remain under the bucket's existing retention behavior; uncertain sends never trigger automatic media deletion.

Validation passed: 1,796 isolated backend tests (74 skipped), TypeScript, focused ESLint, mobile build/sync, six browser scripts, 21st review (zero findings), Android build/install and production deployment build. New fixtures cover no upload before Send, file validation, double clicks, upload failures without a send, unknown recovery after navigation, rejected retry reuse and slow-upload/global-lock/new-draft preservation. Native fixtures verified actual Ogg/Opus playback/seek/pause/close cleanup, native document-picker opening, a real generated PDF selected from Android Downloads into the preview, and a simulated upload/send with zero runtime errors. The generated local/device picker files were removed.

Backend-only release `d9b07c6f100e90d8f599de8bc418ae7e647b582a` is live, directly after `20b3a27a113581d5ed65e34c1c6be13e37f2315c`. Seven backend/shared-type/test files were released; mobile source and unrelated workspace edits were excluded. The established updater passed database readiness, candidate/live auth/login/PDF, active-call gate and public login and returned exit 0. No migration was applied. Runtime image is `sha256:20e31eefb9d67cd472ec28ca4f589fa96d2c7057fc4e2bfa0b356f3e08aceb60`; rollback retains `sha256:4380a1d6c53003ef57f99b2817b89f926b2b85c903a6b11f0c84cd493198df5d`.

Live native checks confirmed textReplies/mediaReplies true, a generated 111-byte PNG and 881-byte PDF uploaded with HTTP 201, matching stored MIME/size metadata, and both samples removed successfully with HTTP 200. An existing 5,282-byte audio/ogg recording downloaded with HTTP 200 and decoded metadata successfully, without playback or retention of its content. The actual paperclip was enabled, the app had zero alerts and its live 100-row inbox was restored. Public login 200, protected inbox 307, unauthenticated web send/calls/mobile messages/upload 401, native upload preflight 204 and foreign-origin upload 403 passed. Provider sends were simulated; no real customer message was sent. An internal-contact delivery check and physical-device validation remain outstanding.

Server evidence is under `/docker/wacrm/backups/mobile-attachments-20261116/`. Candidate containers/environment files were removed, the resource-limited builder stopped, temporary SSH access removed with other keys preserved, and a fresh access attempt denied before local key deletion. Native fixtures, test files and debug forwards were removed. The updated app remains signed in on the inbox.


### Messaging-style mobile UI and inline media — 16 November 2026

The user requested a more familiar WhatsApp/Telegram-style UI with Apple styling, inline image previews and inline voice listening. Reworked the mobile palette and hierarchy into blue/white surfaces, large Chats heading, round contact initials, compact chat header, grouped bubbles, receipt icons, rounded input/send controls and functional options menu. Document cards display their recorded filename/caption, and status labels remain available to assistive technology. The choice is recorded in `.21st/design.json`; it applies to mobile only.

Added `chat-media.tsx` and `inline-media.tsx`. Photo thumbnails and audio load near the viewport through the existing authenticated media endpoint. Photos expand on tap; the full viewer reuses the thumbnail download. Inline audio has real duration, seeking, play/pause and 1×/1.5×/2× speed controls. A single-player coordinator pauses previous playback, and leaving/backgrounding the chat releases or pauses media. No invented waveform, customer presence, unsupported navigation tab or fake action was added.

A conversation-scoped, memory-only cache retains at most 24 MiB of cached blobs, with active display URLs owned independently by consumers. It deduplicates simultaneous consumers, aborts unreferenced pending downloads, evicts cached blobs and clears on conversation exit. Each consumer releases its URL. Fetches preserve bearer auth, no-store, source validation through the existing server endpoint, abort/timeouts and 16 MB limits. The current account/conversation RLS revalidation flow still removes the conversation when access is lost. Login, realtime, 100-conversation/50-message caps, uploads, tracked sends and uncertainty recovery remain intact. Backend revision remains `d9b07c6f100e90d8f599de8bc418ae7e647b582a`; no backend deployment or migration was needed.

Verification passed: mobile build/sync, root TypeScript, focused lint, seven browser scripts, 21st review (zero findings), Android debug build/install and native checks. The new chat-design script checks 320/390/430px portraits and landscape, composer bounds, options-menu behavior and shared full-photo requests. Updated fixtures check authenticated visible thumbnails, PDF navigation, inline Ogg/Opus decode/play/seek/pause/speed, only one playing voice and cleanup on chat exit. Auth/realtime/receipt, text send, attachment upload/recovery, scroll/draft and demo regressions passed. On Android API 37, a first tap started unmuted synthetic silence, options dismissed with hardware Back, and the expanded keyboard reduced the viewport to 578px while input/Send ended at 570px with zero overflow. No runtime errors or real sends occurred.

SystemBars explicitly selects light surfaces/dark icons and initial viewport cover while retaining the existing safe-area/keyboard handling. Native fixtures and debugging forward were removed and the real 100-row inbox restored. Synthetic screenshots are under `/tmp/wacrm-mobile-ui/`, including `chat-redesign-390.png`. The 21st catalog returned HTTP 401; existing components and local Apple-design guidance were used. Physical-device validation remains outstanding.


### Smoothness and cleanup refinement — 16 November 2026

The user requested a smoother, cleaner feel after the messaging redesign. Reduced header/status clutter, removed nested document borders/instructional labels, softened press feedback and added a short fade for first-load photos while cached photos remain immediate. Motion uses the existing design context with a shared ease-out token, 160ms transform/opacity transitions, focus-visible suppression and reduced-motion alternatives. Repeated chat navigation stays immediate; only the explicit pointer-triggered jump-to-latest uses browser smooth scrolling.

Voice progress now updates native range value and progress paint through a playback-scoped requestAnimationFrame loop, with React time-caption updates at second boundaries. Pause/unmount cancels the loop. Transcript positioning uses a layout effect for initial paint and ResizeObserver for viewport/thread size changes. A native test exposed resize-triggered scroll events changing reading intent before ResizeObserver ran; tracking previous dimensions now preserves bottom anchoring without forcing a reader away from older messages.

Validation: all seven mobile browser scripts passed before the final anchoring correction; the expanded UI regression then passed latest-message and older-reading resize cases after correction. Focused lint, TypeScript, UI review, mobile sync and Android build/install passed. Native photo/PDF/voice checks passed, with voice seek progress within 60ms of media time. Final Android keyboard test measured 578px viewport, reply bottom 570px, bottom gap -0.048px (rounding), no horizontal overflow, and scrollTop 0 preserved while reading older history. No runtime errors or real sends occurred. The updated app is installed and left signed in on the live 100-conversation inbox; temporary fixtures/forward were removed. No backend change or deployment was required.

### Shared contact photos — 16 November 2026

User approved manual contact-photo management after investigating missing pictures in both CRM and mobile. The integration does not receive customer profile photos from WhatsApp Cloud API; the live account initially had no populated avatar URLs. Added a shared CRM editor to contact details and the inbox contact panel, plus mobile list/header display using `contacts.avatar_url`. No WhatsApp send path was changed; the 100-conversation ceiling is unchanged.

The private `contact-photos` bucket is specified by migration 099 (64 KiB WebP objects, no client storage policies). Existing live schema needs no new column; bucket configuration is applied through the Storage API. Authenticated GET/POST/DELETE routes verify the signed-in user, account, contact RLS and mutation role. Inputs have MIME/signature/decoded-format, streamed 5 MB and decoded-pixel limits; Sharp applies orientation, square resize and metadata removal. Immutable versions plus If-Match/database compare-and-swap protect simultaneous edits. The old private object is removed after successful replacement; the route only serves the current contact version.

Native photos load lazily through the protected CRM endpoint with bearer authentication, no redirects, bounded streams and a user-scoped in-memory cache. Only configured Supabase HTTPS public storage is allowed for legacy sources; foreign sources are rejected without a fetch. Photos synchronize through the existing 30-second foreground reload or Refresh. Photo management remains in the web CRM.

Validation completed locally: 1,809 backend tests passed with 74 existing skips; root/mobile TypeScript and focused lint passed; the CRM editor harness and all eight mobile browser scripts passed; 21st review reported zero findings. Android build/install passed and native fixtures verified authenticated display/cache, replacement, removal, permission fallback and foreign-source protection. No real messages were sent. Deployment and live canary evidence are recorded below after verification.

Live deployment completed at `a40684b1b2ca410f3a03840172144d4e45bd6827`; bucket 099 configuration was verified private/WebP-only/64 KiB through the Storage API. Production build, database preflight, login/API/PDF health and active-call deployment gate passed. Public login 200, protected pages 307, protected APIs 401, native photo preflight 204, foreign origin 403 and invalid bearer 401. The live synthetic canary verified bearer upload/replacement, old-version 404, real cookie-authenticated CRM controls and native authenticated 256px decode in list/header. All test objects/contact were deleted; original 730 contacts, zero populated avatars and an empty bucket were verified. Rollback matches the preceding `d9b07c6` image. Evidence: `/docker/wacrm/backups/contact-photos-20261116/verification.json`. The emulator is restored to the live inbox; no real messages were sent.

Temporary deployment access was removed and a fresh SSH attempt was denied. Local deployment keys and the native debugging forward were removed.

### Daily chat workflow — 16 November 2026

User approved the next slice: shared read acknowledgement and contact details. Mobile marks a conversation read after loaded history is showing its latest messages in the foreground. Scroll state, open dialogs, background lifecycle and viewer roles gate the operation. The server checks the user's profile/account/conversation under RLS; agent-level read mutations compare the client count/timestamp with the current row and conditionally update those same fields. Successful acknowledgements patch only a matching local snapshot; conflicts refetch, failed writes retain unread status and expose Retry. Provider read receipts and the website's existing read implementation are unchanged.

Added a contact modal launched from the chat identity. It reads the conversation-linked contact, tags and latest 50 notes through an authenticated endpoint, with explicit account filters and RLS. The app offers phone/email copy, empty/loading/error/retry states, manual refresh, Arabic content, focus trapping, Escape and Android Back. Backgrounding unmounts loaded contact content and cancels its request; resume fetches fresh authorized data. Contact editing remains in the web CRM. The loaded inbox ceiling remains 100 and history 50.

Local validation: 15 focused route tests; full isolated backend suite 1,824 passed and 74 existing skips; root/mobile TypeScript, focused lint and 21st review passed. All nine mobile browser scripts passed; native fixtures verified read acknowledgement, Arabic contact details, refresh, access removal/retry, Escape and Android Back returning to the chat. Android debug build/install passed. No real WhatsApp messages were sent. Production deployment/live synthetic canary results follow after verification.

Live backend release `f269e2c7d5285e996e52986a5377b43fe049ed6d` passed production build, database preflight, login/API/PDF health and the active-call promotion gate. Native actual-API validation confirmed POST read 200, persisted shared unread count zero, rejected stale snapshot 409, saved company/tag/Arabic note display, phone copy and refreshed CRM changes. A test-fixture routing error interrupted the first canary; its synthetic records, including the automatically generated deal, were cleaned up before a successful rerun. Final cleanup explicitly removed the temporary note, deal, conversation, contact and tag. No actual WhatsApp messages were sent. Public health/auth/CORS checks passed. Evidence: `/docker/wacrm/backups/mobile-workflow-20261116/`; rollback retains the preceding `a40684b` image. The updated Android app is installed and restored to the live inbox.

Temporary deployment key removal was verified with a fresh denied SSH connection; local deployment keys and native debugging forwarding were removed.

### Remaining Android work — active goal, 17 November 2026

User requested all remaining items, then clarified that there are no Firebase/Apple Developer/Google Play accounts and iPhone work should wait until Android is finished. Full remaining requirements and unresolved evidence are tracked in `docs/mobile-remaining-work.md`; the goal is not complete.

Delivered voice recording through the existing pinned Ogg/Opus worker and tracked upload/send/reconciliation pipeline. Generated silence verified real encoding/decoding, preview-before-upload, explicit Send, cancellation, permission failure and unknown-outcome recovery in browser and Android WebView. Actual microphone hardware and test-recipient delivery remain unverified. Backend `425ac0c` passed 1,826 tests with 74 existing skips and live upload/decode/delete without a WhatsApp send. Recorder tests dispose their injected generated-audio source and restore the real media capture function. Android is configured for microphone permission; no personal speech was captured by the agent.

Delivered Today with authorized due/unclaimed tasks, pagination, Qatar dates, take/postpone/complete actions, saved completion outcomes, revision/owner guards and conflict refresh preserving entered text. A separately authorized exact conversation lookup opens older work without raising the 100-row inbox cap. Backend `9227ccb` passed 1,835 tests with 74 existing skips, and all eleven mobile browser suites plus native Today/Back checks passed. Live synthetic completion was recorded and verified; its reminder was delayed beyond the test, and its task, contact, conversation and auto-created deal were removed. No actual customer task or message was changed by the canary. Server evidence lives under `/docker/wacrm/backups/mobile-voice-20261117/` and `/docker/wacrm/backups/mobile-today-20261117/`.

Open Android items: quotation viewing/native sharing; push client, registration and durable dispatch with authenticated deep links; Firebase provisioning/delivery proof; source tracking/CI/signing/distribution and full role/session/device acceptance. Physical Android remains unavailable and the iPhone phase is explicitly deferred. Mobile dependency symlinks, signing keys and provider configuration are now ignored explicitly; native source tracking remains open. Preserve unrelated working-tree changes when committing the mobile source/configuration.

For the 17 November voice/Today rollout, temporary deployment access was removed and a fresh SSH attempt was denied; local keys and native debugging forwarding were removed.


### Quotation viewing and sharing — 17 November 2026

Android now has authorized quotation search/pagination, stored prices and terms, Arabic item details, current PDF viewing, native PDF sharing and customer-chat navigation. Direct WhatsApp dispatch requires explicit recipient/current-PDF confirmation and shares the existing web dispatch service, durable send claim, current document checks and customer reply window. Unknown provider errors cannot reset the claim to ready; only a known rejection permits retry. OS sharing never changes send state.

Backend `d37ce00fe6157764425c9e6535957b2b59e8efb7` is deployed with no migration. Full backend suite: 1,851 passed and 74 existing skips. Twelve browser suites passed, Android build/lint passed, and native fixtures verified PDF pagination/text, chooser filename, hardware Back, confirmation, duplicates, uncertainty and access removal. Live synthetic actual-API checks verified stored values/Arabic, authorized PDF rendering/native sharing and closed-window rejection before transport. Test scripts needed transport/schema and UI synchronization corrections; all attempts were cleaned up. Final document stayed ready/draft, test conversation had zero messages, and quotation/PDF/items/contact/conversation/deal were removed. Public login 200, protected inbox 307, mobile API 401, native preflight 204 and foreign preflight 403 passed. Rollback retains the Today release `9227ccb`. Evidence: `/docker/wacrm/backups/mobile-quotations-20261117/verification.json`. Temporary deployment access and native debugging forward were removed; a fresh SSH attempt was denied.

Open: real internal-recipient quotation delivery, push implementation/Firebase provisioning, Android release/distribution and full role/session/physical-device acceptance. iPhone stays deferred by the user's instruction.
