# VPS updates

The live server uses `/docker/wacrm/docker-compose.yml` for its environment,
Traefik labels and Docker networks. That file contains server-owned configuration
and is deliberately not committed. Its build context must point at GitHub:

```yaml
image: wacrm:latest
build:
  context: https://github.com/hightechhubTrading/wacrm.git#${WACRM_GIT_REF:-feat/ctwa-conversions}
  dockerfile: Dockerfile
  args:
    NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
    NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL}
```

The previous `calling-artifacts/...` build context is obsolete. Do not restore it
for routine updates. The repository Dockerfile compiles the source at the chosen
Git revision and installs Linux dependencies from the lockfile. The Debian runtime
includes headless Chromium and its system libraries for quotation PDFs.

On the configured VPS, update with:

```sh
cd /docker/wacrm
./update.sh
```

`update.sh` is the installed copy of `deploy/update.sh`. It resolves the newest
commit on `feat/ctwa-conversions`, builds that exact revision, smoke-tests an
unrouted candidate with the current runtime environment, waits for active calls
to end (by exiting for retry), then replaces the app. It checks health and the
running revision, and restores the previous image if promotion fails. Runtime
credentials, TURN settings, networks and HTTPS routing stay in the server's
Compose file. It never changes database migrations automatically.

The dedicated `wacrm-builder` caps builds at 2 GB RAM, 4 GB RAM plus swap and one
CPU. The VPS has a 4 GB swap file at `/swap-wacrm-build` as additional headroom.
The Dockerfile enables the installed Next.js low-memory webpack option and one
build worker. Keep these limits when replacing the builder.

Inspect the running revision:

```sh
docker exec wacrm cat /app/.next/REVISION
```

Roll back the most recent scripted update:

```sh
docker tag wacrm:rollback wacrm:latest
docker compose up -d --no-build --no-deps --force-recreate wacrm
```

Manual `docker compose build --pull wacrm` now fetches the configured branch, too.
Use `./update.sh` for the resource cap, revision recording, candidate check and
rollback. Building alone does not restart the running app. Pushing a commit to
GitHub does not automatically deploy it.

## Reverse-proxy network requirement

The app's internal health check does not prove the public reverse proxy can
reach it. On the current VPS, Traefik is `chatwoot-traefik-1` and must share
`hth_hth_default` with `wacrm`. Keep this connection in the proxy's Compose
configuration, not just in a one-time `docker network connect` command:

```yaml
# /root/chatwoot/docker-compose.yml — merge with existing settings
services:
  traefik:
    networks:
      - chatwoot-net
      - wacrm_proxy
networks:
  wacrm_proxy:
    external: true
    name: hth_hth_default
```

The app's server-owned Compose file must also include this label:

```yaml
services:
  wacrm:
    labels:
      - traefik.docker.network=hth_hth_default
```

On 2026-10-17, the current application revision responded internally while
public requests returned Gateway Timeout: the proxy only belonged to
`chatwoot_chatwoot-net`, and logged timeouts dialing the app's `172.16.6.4:3000`
address. The proxy was attached to the shared network, both Compose files were
updated, and only the app was recreated after checking that no calls were active.
The deployed app remained at `ab046e9d009c45f74eae7585dd53cd8b5b127e32`.
Backups are in `/docker/wacrm/backups/network-recovery-20261017T092156Z`.
Public checks returned login 200, unauthenticated inbox redirect 307 and
protected calls endpoint 401. Temporary recovery SSH access was removed.

The updater now checks the public `/login` URL from `NEXT_PUBLIC_SITE_URL`
before declaring promotion successful. An unreachable public route fails the
update and invokes its existing rollback path.

## Required database checks for the catalog/security release

The new image runs `deploy/check-database.mjs` before starting Next.js. The updater
also checks the candidate explicitly before promotion. Zero-row schema queries
require migration 077; an identity-free conversion probe must be denied by the
authenticated-only RPC added in migration 076. The probe uses no customer ID and
cannot record a conversion. Missing schema/functions stop the candidate and leave
the currently running website in place.

Migration 077 is already recorded in the connected app database. Read-only release
preflight on 19 October found migration 076's conversion RPC absent. Apply and
validate **076 before deploying this revision**; Git push does not apply it. Do not
remove the guard or restore service-role conversion writes to bypass that order.
Refresh the installed `update.sh` from this repository when updating the deployment
tooling. Test the guard locally with `node --test deploy/check-database.test.mjs`.

Catalog collection/search update (28 October 2026): this revision also requires
`078_catalog_collection_search.sql` before application promotion. It adds collection
records, product-search passages, supersession metadata and atomic document-index
replacement. The deployment preflight probes its columns/tables. Apply only reviewed
migrations through the timestamped linked-database process; do not push the numeric
migration directory wholesale. The HTH consolidation is a separate dry-run-by-default
script, documented in `docs/ai-knowledge-catalog.md`; neither it nor migration 078 has
been applied as part of local implementation.

Live status, 28 October 2026: migration 078 is recorded as `20261028141920`;
076/077 were verified present. The scoped catalog release
`bb770f8e299409c932a920fe419c666e5b34ad2e` is deployed, the separate consolidation
completed, and all 10 approved product passages have vectors. The server updater
now includes the candidate database preflight. Release evidence and recovery
locations are in `docs/ai-knowledge-catalog.md`, “Live rollout”.
