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
