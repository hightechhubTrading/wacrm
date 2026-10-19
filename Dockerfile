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
    NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build -- --webpack
RUN printf '%s\n' "$SOURCE_COMMIT" > .next/REVISION

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
ARG SOURCE_COMMIT=unknown
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
RUN groupadd --system nodejs && useradd --system --gid nodejs --create-home nextjs
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/deploy/check-database.mjs ./deploy/check-database.mjs
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
# Quotations render PDFs in headless Chromium. Install its Linux libraries and
# browser in the image, where the unprivileged runtime user can read them.
RUN npx playwright install --with-deps --only-shell chromium
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node deploy/check-database.mjs && exec npm start"]
