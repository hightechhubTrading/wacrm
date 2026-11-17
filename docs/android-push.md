# Android push delivery

Implementation in progress; Firebase credentials and real delivery are not configured.
Android first. iPhone remains explicitly deferred.

## Server implementation — 17 November 2026

Local code now includes migration 100, private device/preferences/outbox tables,
human-authenticated `/api/mobile/push` settings/registration, capability-based
revocation, FCM HTTP v1 transport and an isolated drain called by the existing
secret-authenticated automation cron. Configuration is disabled by default.
This code and migration have **not** been deployed/applied to production.

Registration is bound to the verified Auth `session_id`; SQL checks the actual
session deadline, banned/deleted user state and current account role. Native
bindings must persist an incrementing `version` with their token. Older versions
cannot overwrite a rotated token, and an invalid old token cannot disable its
replacement. Bindings cannot be moved between projects/apps/environments.

Migration 100 adds a local insertion timestamp to messages without changing
their original Meta `created_at`. Non-blocking triggers schedule quickly; the
worker also reconstructs missing jobs from committed sources after a scheduling
failure. Recovery excludes events predating device registration. Message alerts
expire after 15 minutes, other staff notifications after an hour; expired events
do not build up overnight. Twenty leased jobs run concurrently per cron batch.
Quiet hours use PostgreSQL timezone conversion. Stable conversation tags replace
earlier generic cards and suppress duplicate visible cards on ambiguous retries.

The deployment preflight requires all three tables and a read-only sentinel for
source hooks, RLS, service/client grants and RPC signatures. Apply migration 100
before deploying this server revision; do not use a broad legacy `db push` against
this project's timestamped migration history. Existing production stays at its
verified quotation release while this slice is prepared.

Required server-only configuration:

```dotenv
FIREBASE_PROJECT_ID=your-firebase-project
MOBILE_PUSH_APP_ID=com.hightechhub.crm.demo
MOBILE_PUSH_ENVIRONMENT=development
FIREBASE_SERVICE_ACCOUNT_FILE=/run/secrets/firebase-service-account.json
```

Mount the service-account file read-only outside the repository. The API/worker
only report configuration active after matching project metadata and parsing a
valid RSA key. No `VITE_*` variable may hold server credentials. OAuth is scoped
to Firebase Messaging, signed with RS256 and exchanged only with Google's fixed
token endpoint. Provider error bodies, keys and device tokens are never logged.
Missing/invalid credentials pause queue claiming rather than consuming retries.

Native registration request fields: `action: register`, binding `id`, 43-character
base64url `secret`, FCM `token`, positive integer `version`, `appId`, `projectId`.
Account/user/session/environment are derived server-side. `action: revoke` only
accepts `id` and `secret`, so logout cleanup works after JWT expiry. Preferences
accept `enabled`, nullable paired minute values `quietStart`/`quietEnd` and an
IANA `timezone` (default Asia/Qatar). A viewer cannot enable push.

Local verification: 1,881 backend tests (74 existing skips), 48 deployment
preflight checks, root typecheck and focused lint passed. Real isolated PostgreSQL
tests cover caps, roles, account/session/deadline/ban/delete changes, assignment,
source recovery/deduplication, quiet hours, token versions, invalidation/revocation,
grants and overlapping transactions (five jobs, five unique claims). Fixture DBs
and roles are removed after every run. The live Supabase schema was queried only
for required Auth columns/permissions; no production records were changed.

Run `node scripts/check-mobile-push-database.mjs` with `MOBILE_SQL_CONTAINER` set
to a disposable Postgres 17 container. CI supplies its own service container.
The optional SSH fixture mode also creates only a uniquely named temporary DB,
and never points its test statements at a business database.

## Contract

- A device binding belongs to a verified Supabase user/session/account, Firebase
  project, app ID and environment. The server accepts only its configured app.
  Registration requires an agent or higher role; current membership is checked
  again in SQL. Token ciphertext uses the existing AES-GCM server encryption.
- The app persists a random binding UUID and 256-bit revocation secret in the
  Android Keystore adapter. Only a SHA-256 secret hash is stored on the server.
  That capability permits revocation after session expiry; it cannot read data
  or register another token. A new login gets a new binding. Logout also deletes
  the FCM token and clears delivered alerts; failed revocations are retried.
- Durable events come from committed incoming customer messages and existing
  staff notifications. A unique source/device key deduplicates scheduling.
  A bounded worker leases jobs atomically, rechecks current membership,
  conversation assignment, session, device/token revision and preferences,
  then sends a generic alert. Quiet hours use the saved IANA timezone.
- The payload contains no customer name, message, price, attachment or media URL.
  IDs are navigation hints. Tapping requires a current session and an authorized
  exact conversation read; an old alert grants no access after reassignment.
- Provider acceptance is distinct from device receipt. Transient failures retry
  with bounded backoff and expiry; invalid tokens are disabled only if their
  hash still matches the attempted token. A reused notification tag suppresses
  duplicate visible cards after ambiguous transport/retry. Exactly-once external
  delivery is not promised.
- Configuration is disabled by default. Neither schema nor code means live push
  is ready. No provider request may run without valid server configuration.

## Remaining integration and acceptance

Server/schema implementation and local isolated checks are complete; hosted
clean-checkout acceptance remains pending. Next wire native permission,
registration/rotation, preferences, logout cleanup
and authenticated tap navigation. Use synthetic data/provider responses first.
Verify SQL policies, tenant/assignment/session revocation, overlapping leases,
quiet hours, expiry, retries, token rotation and cleanup before applying a migration.
Verify the configured Firebase project/app and server credentials separately.
Real foreground/background/terminated delivery and physical-device checks remain
required. The user has no Firebase project yet.

Before rollout, also verify the hosted Auth session policies against the actual
deployment. The server explicitly checks stored `auth.sessions.not_after`; Auth
inactivity/single-session settings are enforced on refresh by Supabase, not by
inventing an independent timeout in this feature. See [Supabase sessions](https://supabase.com/docs/guides/auth/sessions).
