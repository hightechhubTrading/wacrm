FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG SOURCE_COMMIT=unknown
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_BUILD_LOW_MEMORY=1 \
    NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build -- --webpack
RUN printf '%s\n' "$SOURCE_COMMIT" > .next/REVISION

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
ARG SOURCE_COMMIT=unknown
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
RUN groupadd --system nodejs && useradd --system --gid nodejs --create-home nextjs
# Keep runtime dependencies independent of source/build artifacts so an app-only
# release can reuse Chromium and its system libraries.
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
# An operator can select an official mirror when the default CDN is slow.
# Debian still verifies signed repository metadata and package checksums.
RUN sed -i "s@^URIs: http://deb.debian.org/debian\$@URIs: ${DEBIAN_MIRROR}@" /etc/apt/sources.list.d/debian.sources \
    && npx playwright install --with-deps --only-shell chromium
COPY --from=builder /app/public ./public
COPY --from=builder /app/deploy/check-database.mjs ./deploy/check-database.mjs
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node deploy/check-database.mjs && exec npm start"]
