# Android companion — feasibility demo

This React/Vite/Capacitor app packages its interface locally. It supports password sign-in to the existing Supabase project, conversations/history under the signed-in user’s RLS, and tracked text replies through the deployed CRM API. A separate synthetic demo remains available. Photo/document viewing, voice playback and tracked photo/file replies are installed; backend revision `d37ce00fe6157764425c9e6535957b2b59e8efb7` is live. Realtime subscriptions invalidate authorized reads, with reconnect/resume recovery and a 30-second fallback while foregrounded. The inbox stays capped at 100 conversations and each open thread at 50 messages. Android sessions use a local Capacitor plugin with Android Keystore AES-GCM encryption. Browser preview remains memory-only. The app identifier `com.hightechhub.crm.demo` is for development only.

## Run

From this directory: `npm ci`, then `npm run dev` for browser development. `npm run sync` builds and copies assets into Android; `npm run android` opens Android Studio. Compile with JDK 21 and a compatible Android SDK. This Android Studio installation bundles JDK 25, which is too new for Gradle 8.14.3; a separate JDK 21 is installed on the M2-backed APFS image. The generated Capacitor project currently targets SDK 36; the API 37 emulator can run it.

On this Mac, mount `/Volumes/2TB M2/AndroidAVD-Mac.sparsebundle` first. SDK is linked from `~/Library/Android/sdk` to the M2. Keep build caches on external storage where possible. Native project source is versioned with the mobile app. The Android companion workflow checks synthetic browser flows and compiles/lints a debug build; signed release distribution remains open. Generated bundles, dependencies, build outputs, local SDK paths and credentials are ignored.

Local dependency storage: `mobile/node_modules` currently links to `/Volumes/AndroidAVD/mobile-dependencies/node_modules` to avoid ExFAT allocation overhead and the full project disk. When dependencies change, copy `package.json` and `package-lock.json` into `/Volumes/AndroidAVD/mobile-dependencies/`, then run `npm ci --prefix /Volumes/AndroidAVD/mobile-dependencies --cache '/Volumes/2TB M2/npm-cache'`. On another machine, a normal local `npm ci` is sufficient.

## Checks

- `npm run build`: mobile TypeScript plus Vite production build.
- From the repository root: `npx eslint mobile/src/main.tsx`.
- Start `npm exec -- vite preview --host 127.0.0.1 --port 4175 --strictPort` here; run `node scripts/check-mobile-demo.mjs` from the root. Uses installed Google Chrome.
- Android: install debug APK, open demo inbox, search, open both sample conversations, press hardware Back, and relaunch. No external network is needed by the demo web interface.

## Next slice

The current Supabase project, text-reply backend and attachment endpoint are authorized and connected. Remaining pilot work includes full role/assignment boundaries, session revocation and physical-device validation before broader use. Native shared read acknowledgement and contact details are now implemented; store distribution remains a separate step.

Local build command (from `mobile/android`):

```sh
JAVA_HOME="/Volumes/AndroidAVD/toolchains/jdk-21.0.13+9/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
GRADLE_USER_HOME="/Volumes/AndroidAVD/gradle-cache" \
./gradlew assembleDebug --no-daemon
```

Keep the generated Gradle 8.14.3 wrapper for this spike; do not accept an IDE upgrade to Gradle 9 without checking Android Gradle plugin compatibility. A local ignored `.gradle/config.properties` records the JDK 21 path for IDE use. If Android Studio still selects another JDK, select the JDK 21 installation in its Gradle settings.

Public configuration is in ignored `mobile/.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CRM_API_URL`). Never copy service-role or WhatsApp/AI secrets. CSP permits connections to the configured Supabase and CRM origins. Client transport rejects non-read database requests; text replies use the authenticated CRM endpoint. This is a client guard, not a substitute for server RLS. `node scripts/check-mobile-auth.mjs` tests the auth/read UI using mocked transport, without live credentials.

Secure storage tests: build `:app:assembleDebug :app:assembleDebugAndroidTest`, install both APKs, then run `adb shell am instrument -w -e class com.hightechhub.crm.demo.SessionVaultTest com.hightechhub.crm.demo.test/androidx.test.runner.AndroidJUnitRunner`. Synthetic tests use a separate vault namespace. Do not run blanket dependency-module instrumentation builds: Capacitor dependencies currently have a Kotlin test classpath conflict. Capacitor bridge logging is disabled to avoid session payloads in logs; backups/device transfer are excluded.

Realtime behavior: conversation events are account-filtered, and message events are filtered to the selected conversation. Event payloads are not rendered directly. Every reload revalidates user/membership and queries under RLS. Unsubscribing and generation guards discard stale channel callbacks; unique topic suffixes avoid racing an in-flight unsubscribe during fast lifecycle changes. Membership loss clears data; invalid authentication removes saved session keys and returns to sign-in. Transient network errors keep the saved session for recovery. No production schema/publication changes or customer sends were made.

## Text replies — backend live, 16 November 2026

The installed development app includes a text composer. It enables Send only when the authenticated `/api/mobile/messages` capability response advertises protocol 1 and text replies. The scoped server adapter is deployed at revision `5e498dd03300b40f65485602f2df0598427a7138`. First real sending validation should use an internal contact. Native POST uses the signed-in user's bearer token and the existing send engine; direct Supabase writes remain blocked. `VITE_CRM_API_URL` is the public CRM origin.

`node scripts/check-mobile-send.mjs` uses synthetic HTTP/WebSocket fixtures to test accepted/rejected/unknown outcomes, double clicks, draft preservation and operation-ID reconciliation. It sends no real messages. Pending native operations are encrypted using the Keystore-backed vault; browser pending state is memory-only. Unknown delivery locks Send until a status check resolves it. Signing out clears pending metadata; verify chat history before manually recreating an uncertain reply.

Delivery indicators use the stored WhatsApp message status for outgoing agent/bot messages. Sent means acceptance, Delivered and Read require the corresponding recorded receipt, and unknown status never implies delivery. Customer messages have no outbound receipt label. The auth/realtime fixture covers status transitions without sending real messages.

## Mobile UI — 16 November 2026

The signed-in workspace now has search, All/Unread/Assigned to me filters, contact initials, message previews, date-grouped threads in Qatar time, Arabic typography, and a separate growing reply field. Filters and inbox scroll position survive opening a conversation. Unsent drafts survive navigation in memory (bounded to 100); logout clears them. Uncertain send metadata keeps its existing encrypted native handling. New messages scroll automatically only near the bottom; otherwise a jump control preserves the reading position. Unread badges reflect stored server counts; opening a native conversation now acknowledges read after loaded/latest/foreground checks (see the workflow section below).

The shell owns safe-area padding using Capacitor's injected CSS values with standard environment fallbacks. Android `adjustResize` and viewport resize handling keep the composer above the keyboard. The keyboard check requires an actual expanded software keyboard: the emulator's minimized Gboard toolbar reports input shown but has zero keyboard height.

`node scripts/check-mobile-ui.mjs` uses synthetic fixtures to check 320/390/430px widths, filters/search, scroll restoration, drafts, new-message behavior and a reduced viewport. Run alongside the auth, send and demo scripts against the preview on port 4175. Synthetic previews are written to `/tmp/wacrm-mobile-ui/`. These checks perform no live customer writes.

## Photo and document viewing — live, 16 November 2026

Photo thumbnails load near the visible transcript and open full-size with zoom when tapped. Documents load on tap. PDFs use a lazy-loaded, locally bundled PDF.js worker, fonts and character maps, with pagination, zoom and extracted page text. Android's Back closes the modal first. Missing/expired files, access changes, oversized files and damaged/password-protected PDFs have explicit failure states. Browser previews offer a download; Android can open PDF, text, CSV and common Office documents in a compatible installed app. Office preview requires such an app; the emulator currently has a PDF viewer but no Word viewer.

`GET /api/mobile/media/[messageId]` requires a verified user bearer session, an account profile and current message visibility through RLS. Incoming Meta files use the account's server-held credentials. Outgoing attachments can only proxy known public storage buckets on the configured Supabase origin, including `quotation-pdfs`, without redirects or forwarded user credentials. Files are bounded to 16 MB with streamed limits, served no-store with restricted native CORS, and loaded into ephemeral browser blobs. HTML/SVG are never rendered as documents inside the app.

The native `AttachmentFiles` bridge exposes only a dedicated private cache subdirectory through FileProvider, grants read-only URI access and permits known document MIME types. It keeps at most one opened file, purges/revokes it on next open, startup or sign-out, and uses no public storage permission. An external viewer receives a copy when the user selects Open on device. Closing the preview releases its in-memory blob; it does not delete a file an external viewer has copied independently.

`node scripts/check-mobile-media.mjs` verifies on-demand authorized fetch, decoded photo/zoom, actual two-page PDF rendering/text, pagination, document fallback, retry, unavailable files and dialog closing with synthetic fixtures. The same viewer was tested in the Android WebView, including hardware Back, launching the system PDF viewer and cleanup. The endpoint is deployed: signed-in native checks downloaded/decoded a live JPEG and fetched a valid PDF with no-store responses. Public login/authentication and existing text-reply capability passed. Existing cookie-authenticated website media routes are unchanged. Rollback image `wacrm:rollback` retains the prior text-reply release; server evidence is under `/docker/wacrm/backups/mobile-media-20261116/`.


## Voice playback and photo/file replies — live, 16 November 2026

Visible voice messages load an authorized recording into an inline player with play/pause, seeking, duration and 1×/1.5×/2× speeds. One recording plays at a time. Leaving a chat pauses playback, releases sources and revokes blob URLs; backgrounding the app also pauses playback. Common Ogg/Opus voice messages were decoded in both synthetic native playback and a live metadata-only check. Other incoming audio formats depend on WebView codec support; failures are explicit. Voice recording/sending is not part of this slice.

Use the paperclip to choose one JPG/PNG photo (up to 5 MB), PDF, supported Office document or UTF-8 text file (up to 16 MB). The composer shows a local photo thumbnail or file name/size and an optional caption (up to 1024 characters). Choosing a file does not upload or send it; Send starts the upload. Local file selections are held only in the current conversation view, while text drafts keep their existing navigation behavior. The actual Android document picker and selection-to-preview path passed native checks.

`POST /api/mobile/uploads` uses verified bearer auth, agent role, per-user rate limits, conversation RLS, bounded multipart parsing and file-signature checks before uploading with the caller's storage permissions. It uses randomized account/conversation paths in the existing public `chat-media` bucket. The mobile message adapter accepts only uploaded files belonging to that account/conversation and verifies storage MIME/size metadata before delegating to the established send engine. Existing cookie-authenticated website sends are unchanged. Both text and media capabilities remain protocol 1; attachments stay disabled against older servers.

Media send operations persist only their scoped metadata, URL, caption and operation ID in the existing encrypted pending vault. Unknown outcomes block another send and use GET reconciliation. Rejected sends can reuse their completed upload. A global in-flight guard and pending-vault recheck cover navigation during upload, and resolving an older send preserves a newer draft. Logout invalidates async composer work. An upload can succeed without a subsequent message (for example, secure-persistence failure); these unreferenced objects follow the existing bucket's retention behavior. Never delete an uncertain send's media automatically.

`node scripts/check-mobile-attachments.mjs` adds synthetic upload/send, invalid type/size, no upload before Send, double-click protection, upload failure, unknown recovery, rejected retry and slow-upload/navigation/new-draft tests. Run it with the other five mobile scripts. Full isolated backend validation passed 1,796 tests (74 skipped), TypeScript and the production deployment build; UI lint/review and Android build/install passed. Live checks uploaded generated PNG/PDF samples and removed both, validated storage metadata and enabled capabilities, and decoded a live voice recording's metadata without playback. Provider sends used simulated responses; no real customer message was sent by the agent. First real attachment delivery should use an internal test contact.

Current release `d9b07c6f100e90d8f599de8bc418ae7e647b582a` contains seven backend/shared-type/test files and no migration. Evidence is under `/docker/wacrm/backups/mobile-attachments-20261116/`; `wacrm:rollback` retains the prior photo/document-viewing release. Temporary deployment access and debugging forwards were removed. The emulator is left signed in on its 100-conversation inbox.


## Messaging-style redesign — 16 November 2026

The user selected familiar WhatsApp/Telegram chat patterns with Apple-style hierarchy. The mobile UI now uses a blue/white palette, a large Chats title, circular contact initials, compact conversation headers, softly grouped bubbles, receipt icons, a rounded composer and a functional account-options menu. Document cards show their recorded filename/caption. This direction is scoped to mobile; the website theme and deployed backend are unchanged.

Photos display authenticated inline thumbnails near the viewport and open full-size on tap. Voice messages use inline controls with an actual progress slider, duration and speed selection. No fabricated waveform or presence status is shown. `ChatMediaProvider` shares downloads between thumbnails and the full viewer, holds a per-conversation memory-only blob cache up to 24 MiB (active display resources are owned separately), aborts unused pending fetches and clears on chat exit. Each mounted consumer owns/revokes its object URL. Current RLS removal still clears the conversation through the existing refresh flow. PDFs remain locally rendered in the full viewer and send/reconciliation logic is unchanged.

New `scripts/check-mobile-chat-design.mjs` covers synthetic portrait/landscape rendering, inline photo/audio, shared thumbnail/full-size requests, composer bounds and account-menu dismissal. All seven browser checks, focused lint, root/mobile TypeScript, 21st review and Android build/install passed. Native verification confirmed inline photos/cache reuse, PDF navigation, Ogg/Opus playback/seek/speed/single-player behavior, unmuted first-tap playback of synthetic silence, Back dismissal, media cleanup and a real expanded keyboard. With a 578px viewport, input and Send ended at 570px without overflow. SystemBars uses dark icons on the light app surface. The installed app is left signed in on the live 100-conversation inbox. No backend deployment or real send was needed.

Synthetic visual previews: `/tmp/wacrm-mobile-ui/inbox-390.png` and `/tmp/wacrm-mobile-ui/chat-redesign-390.png` (also 320/430px and landscape variants). The catalog request returned HTTP 401; the redesign uses project components, Lucide icons and the local Apple design guidance. The selected direction is recorded in `.21st/design.json`.


### Smoothness and cleanup pass

Refined press feedback to 160ms transform easing at 0.97 scale, suppressed movement for keyboard focus/reduced motion, and added a short opacity transition only for newly downloaded photos. Cached photos appear immediately. Healthy connection status remains accessible without a permanent visual strip; reconnect/offline warnings remain visible. The Chats header is shorter, and document bubbles use one surface with a type label instead of nested borders and instructional copy.

Playing voice messages update the seek thumb/progress via requestAnimationFrame; React updates the time caption at whole-second changes rather than on every frame. The loop stops on pause/unmount. Chat history scrolls to its initial position before paint and tracks viewport/thread resizing only when the reader was already at the bottom. Resize-generated scroll events no longer overwrite that reading intent. Jump to latest uses native smooth scrolling for pointer input and instant movement for keyboard/reduced motion.

All seven browser regressions passed; the UI check additionally verifies bottom anchoring and preservation of older history during resizing. Lint, root/mobile TypeScript, UI review and Android build/install passed. Native verification confirmed seek progress within 60ms of playback, expanded keyboard input bounds (570px inside a 578px viewport), a bottom gap near zero, and older-history scrollTop remaining zero across keyboard opening. No runtime errors or real sends occurred; the live 100-row inbox was restored and debugging forward removed. Backend remains unchanged.

### Shared contact photos

Customer profile pictures are not supplied by the connected WhatsApp Cloud API. Agents can now add, replace or remove a contact photo in the web CRM, either in Contacts → open contact or the inbox contact panel. JPG, PNG and WebP inputs up to 5 MB are cropped to 256×256 WebP thumbnails with metadata stripped. The app displays the same saved contact photo in Chats and the thread header; use Refresh or wait for the existing 30-second foreground refresh. Contacts without a saved photo keep their initials. The inbox remains capped at 100.

Photos use the private `contact-photos` bucket and the existing `contacts.avatar_url` field. The authenticated route checks account membership and contact RLS for each read; agent-level access plus contact UPDATE RLS is required for changes. Version checks prevent stale replacements. Previous versions become inaccessible after replacement/removal. Native downloads use the user's bearer session, bounded content validation, a user-scoped memory cache and revoked object URLs. External photo URLs never receive the user's token. Native upload controls are outside this slice; photo management is in the CRM.

`node scripts/check-contact-photos.mjs` checks the actual CRM editor with mocked requests. `node scripts/check-mobile-contact-photos.mjs` checks authenticated decode/cache, replacement refresh, removal, denied fallback and foreign-source protection with synthetic data. These fixtures do not change real contacts or send messages. Backend route tests cover authorization, account scoping, image conversion, conflicts and failure cleanup.

Live release `a40684b1b2ca410f3a03840172144d4e45bd6827` passed production build, database preflight, public login, authenticated photo operations and Android decode. A temporary synthetic contact verified bearer upload/replacement, old-version 404, cookie-authenticated CRM upload/removal and actual native list/header rendering. The contact and all test photos were deleted; post-test checks confirmed the original 730 contacts, zero saved avatars and an empty private photo bucket. No real WhatsApp messages were sent. Server evidence: `/docker/wacrm/backups/contact-photos-20261116/`; rollback retains `d9b07c6`. Existing contacts keep initials until an agent supplies a photo. The updated Android build is installed.

Temporary deployment access was removed and a fresh SSH attempt was denied. Local deployment keys and the native debugging forward were removed.

### Read status and contact details

Opening a chat acknowledges the shared CRM unread count after history has loaded and the latest messages are visible in the foreground. Reading older history, loading, backgrounding, open attachment/contact dialogs and viewer roles do not trigger acknowledgements. A server-verified count/timestamp snapshot plus conditional database update prevents the app from clearing newer arrivals. Counts change locally only after server confirmation; conflicts cause a refetch and failures offer Retry. This changes the shared team inbox unread state; it does not send a WhatsApp read-receipt request.

Tap the contact name/photo in a chat header to open contact details. View phone, email, company, saved photo, tags and the latest 50 notes; copy phone/email and refresh to see CRM changes. The view supports Arabic content, accessible modal focus, scrolling, Escape and Android Back. Data is discarded when backgrounded and fetched again on resume. Contact information, tags and notes are managed in the web CRM in this slice.

The two new mobile endpoints require a human bearer session and recheck account membership plus conversation RLS. Contact reads also scope contact/notes queries to the account; mutations require agent access and conversation UPDATE RLS. No service credentials, provider calls or migrations are added. `scripts/check-mobile-workflow.mjs` covers read eligibility, conflicts, failure retry, viewer boundaries and contact loading/refresh/access removal using synthetic data.

Backend release `f269e2c7d5285e996e52986a5377b43fe049ed6d` is live; no migration was required. All nine mobile browser scripts and native checks passed, including background/resume eligibility, contact refresh, permission loss, Escape and hardware Back. The live native canary verified a successful read acknowledgement, shared database unread count of zero, stale-snapshot 409, company/tags/Arabic notes, phone copying and a CRM company edit visible after Refresh. Temporary contact, conversation, auto-created deal, note and tag records were removed. No real messages were sent. Server evidence: `/docker/wacrm/backups/mobile-workflow-20261116/`; rollback retains `a40684b`.

Temporary deployment key removal was verified with a fresh denied SSH connection; local deployment keys and native debugging forwarding were removed.

### Voice recording — 17 November 2026

The Android composer now offers a microphone when the text draft is empty. Start, Stop, preview, discard and explicit Send share the existing tracked attachment pipeline. Recording uses the website's pinned Ogg/Opus worker, mono 48 kHz at 24 kbps, with a five-minute cap. The mic stream stops on discard, chat exit, opening contact details, backgrounding or logout; recordings are not automatically uploaded. Permission failures show a retryable explanation. Audio cannot carry a caption; an existing text draft is preserved by keeping recording unavailable while it is nonempty. Pending audio sends retain only their scoped operation metadata in the encrypted vault, with the same uncertain-outcome reconciliation rules as other replies.

Backend `425ac0ca81fa3b726942276ee2d34b81ae4dc713` adds voice capability negotiation and bounded mono Ogg/Opus upload validation. It keeps protocol 1 compatible with existing clients and uses the existing send service. No migration is required. Full isolated tests: 1,826 passed / 74 existing skips. All ten mobile browser checks passed after repeating an auth check that overlapped a preview rebuild; native WebView generated-audio checks passed. The live canary uploaded generated silence, decoded it through a blob URL and deleted the file; no WhatsApp send was performed. Physical microphone capture and actual delivery on a real Android phone remain unverified, so voice acceptance is not complete. Evidence: `/docker/wacrm/backups/mobile-voice-20261117/`.

### Today and follow-ups — 17 November 2026

The new Today tab lists due/overdue follow-ups assigned to the current user or unclaimed within authorized conversations, with Qatar dates, exact totals, paging and refresh. Agents can take a task, move it to tomorrow at 09:00 Qatar time, or complete it with a saved outcome of at least ten characters. Viewers can read only. Task updates compare the saved revision and owner before a service write; conflicting updates refresh the work list and preserve entered completion text for review. Contact/chat reads remain under current user RLS. Opening an older task uses a separately authorized exact conversation lookup rather than increasing the 100-row inbox ceiling.

Backend `9227ccb97d657c6119871a5dc4a1f4498d29ac2a` is live. The Android app is installed. Nine new endpoint tests passed, and the full isolated backend suite passed 1,835 tests with 74 existing skips. Eleven browser suites and native task/Back checks passed. The auth fixture was extended to model a denied exact conversation lookup in addition to its existing 100-row list restriction. A live synthetic task was seeded with its reminder deferred beyond the test, displayed in native Today, completed through the actual API and verified in the database. Its contact, conversation, auto-created deal and task were removed. No actual customer task was completed or WhatsApp message sent. Evidence: `/docker/wacrm/backups/mobile-today-20261117/`; rollback retains the voice release.

For the 17 November voice/Today rollout, temporary deployment access was removed and a fresh SSH attempt was denied; local keys and native debugging forwarding were removed.


## Quotations — 17 November 2026

The Quotations tab lists the quotations available under the signed-in user's existing account/RLS permissions. Search by client or reference, load more, open saved amounts/items/Arabic descriptions and commercial terms, or jump to the authorized customer chat. Mobile displays persisted prices without recalculating commercial values. PDF preparation/editing stays in the CRM.

View PDF renders the current authorized document with the bundled PDF viewer. Share PDF opens Android's system chooser using a read-only FileProvider URI and the quotation reference/revision as its filename. Sharing does not mark a quotation as sent. Temporary shared files are bounded, expired and cleared on startup/logout; another app can retain a copy after the user selects it. Every PDF action revalidates the current document/version before fetching. Legacy PDFs can be viewed/shared but must be prepared again in the CRM before direct WhatsApp sending.

Send on WhatsApp requires a separate recipient/PDF confirmation. The server reuses the CRM's durable quotation claim and send service, current revision checks, role/RLS and customer reply window. Unknown provider outcomes keep the claim locked; status refresh reconciles it before another attempt. Accepted means accepted by WhatsApp; delivery requires the chat's stored receipt.

Validation: 1,851 backend tests passed, 74 existing skips; twelve browser suites and Android build/lint passed. Native fixtures covered two-page PDF, chooser filename, hardware Back, confirmation, duplicate protection and uncertain recovery. A temporary live synthetic quotation verified authorized list/detail/PDF, Arabic/stored values, native sharing and real server rejection before provider transport for a closed reply window. All synthetic PDF/quotation/item/contact/conversation/deal records were removed, the document remained ready/draft and no message was created. Real internal-recipient delivery and physical Android acceptance remain open. Evidence: `/docker/wacrm/backups/mobile-quotations-20261117/verification.json`.


## Reproducible Android validation

Copy `.env.example` to `.env.local` and set only the three public client values before building for the real CRM. Both the web and mobile dependency trees have separate lockfiles. Run `npm ci` at the repository root and `npm ci --prefix mobile`, then `npm --prefix mobile run sync`. Compile with JDK 21 and Android platform/build-tools 36. The Gradle wrapper and custom native plugins are committed; dependencies, packaged web assets, build/cache output, device files, provider configuration and signing keys are excluded. The web Docker build excludes `mobile/` entirely.

`.github/workflows/mobile.yml` uses Node 22, JDK 21, Android 36 and locked installs. It builds the mobile bundle, runs source lint and twelve synthetic browser suites, then assembles/lints Android. Its placeholder public configuration cannot sign in to the live CRM. CI does not sign, publish or distribute a production app, and does not prove physical-device or real-message delivery. Production signing, update identity, internal distribution and Firebase push configuration remain separate open requirements.


Hosted source verification at `14b9949`: [Android pipeline passed](https://github.com/hightechhubTrading/wacrm/actions/runs/43993651472) and [web CRM pipeline passed](https://github.com/hightechhubTrading/wacrm/actions/runs/43993651474). The clean Android build checks all twelve browser suites plus native compile/lint; the web suite passed 1,853 tests with 74 existing skips and production build. The final debug APK is installed in the emulator. Latest-message jumps finish immediately so keyboard resizing cannot interrupt them; older-message reading position remains covered by the UI suite. These checks do not replace the open push, signing or physical-device acceptance gates.
