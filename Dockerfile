FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
# Sentry (launch plan step 3). The DSN is public by design and baked into the
# bundle like the Supabase vars. Org/project/release are not secrets either.
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN     SENTRY_ORG=$SENTRY_ORG     SENTRY_PROJECT=$SENTRY_PROJECT     SENTRY_RELEASE=$SENTRY_RELEASE
# The auth token (uploads source maps) IS a secret: it arrives as a BuildKit
# secret mount, exists only for this RUN, and is never written to a layer — an
# ARG/ENV would be readable by anyone with the image (`docker history`).
# No secret supplied (local/CI builds) = the upload is skipped, build still works.
RUN --mount=type=secret,id=sentry_auth_token     if [ -s /run/secrets/sentry_auth_token ]; then       export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)";     fi;     npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
