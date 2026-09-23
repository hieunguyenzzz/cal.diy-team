FROM --platform=$BUILDPLATFORM node:20 AS builder

WORKDIR /calcom

## If we want to read any ENV variable from .env file, we need to first accept and pass it as an argument to the Dockerfile
ARG NEXT_PUBLIC_LICENSE_CONSENT
ARG NEXT_PUBLIC_WEBSITE_TERMS_URL
ARG NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL
ARG CALCOM_TELEMETRY_DISABLED
ARG DATABASE_URL
ARG NEXTAUTH_SECRET=secret
ARG CALENDSO_ENCRYPTION_KEY=secret
ARG MAX_OLD_SPACE_SIZE=6144
ARG NEXT_PUBLIC_API_V2_URL
ARG CSP_POLICY

## We need these variables as required by Next.js build to create rewrites
ARG NEXT_PUBLIC_SINGLE_ORG_SLUG
ARG ORGANIZATIONS_ENABLED

ENV NEXT_PUBLIC_WEBAPP_URL=http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER \
  NEXT_PUBLIC_API_V2_URL=$NEXT_PUBLIC_API_V2_URL \
  NEXT_PUBLIC_LICENSE_CONSENT=$NEXT_PUBLIC_LICENSE_CONSENT \
  NEXT_PUBLIC_WEBSITE_TERMS_URL=$NEXT_PUBLIC_WEBSITE_TERMS_URL \
  NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL=$NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL \
  CALCOM_TELEMETRY_DISABLED=$CALCOM_TELEMETRY_DISABLED \
  DATABASE_URL=$DATABASE_URL \
  DATABASE_DIRECT_URL=$DATABASE_URL \
  NEXTAUTH_SECRET=${NEXTAUTH_SECRET} \
  CALENDSO_ENCRYPTION_KEY=${CALENDSO_ENCRYPTION_KEY} \
  NEXT_PUBLIC_SINGLE_ORG_SLUG=$NEXT_PUBLIC_SINGLE_ORG_SLUG \
  ORGANIZATIONS_ENABLED=$ORGANIZATIONS_ENABLED \
  NODE_OPTIONS=--max-old-space-size=${MAX_OLD_SPACE_SIZE} \
  BUILD_STANDALONE=true \
  CSP_POLICY=$CSP_POLICY

COPY package.json yarn.lock .yarnrc.yml playwright.config.ts turbo.json i18n.json ./
COPY .yarn ./.yarn
COPY apps/web ./apps/web
COPY apps/api/v2 ./apps/api/v2
COPY packages ./packages

RUN yarn config set httpTimeout 1200000
RUN npx turbo prune --scope=@calcom/web --scope=@calcom/trpc --docker
RUN yarn install
# Build and make embed servable from web/public/embed folder
RUN yarn workspace @calcom/trpc run build
RUN yarn --cwd packages/embeds/embed-core workspace @calcom/embed-core run build
RUN yarn --cwd apps/web workspace @calcom/web run copy-app-store-static
RUN yarn --cwd apps/web workspace @calcom/web run build
# BUILD_STANDALONE=true (above) makes `next build` also emit .next/standalone,
# a self-contained server + pruned node_modules - but start.sh still boots via
# `yarn start`, not the standalone server, so it's ~400MB of dead weight. We
# leave BUILD_STANDALONE itself untouched (removing it is a separate, unverified
# change) and just delete the output we don't consume.
RUN rm -rf node_modules/.cache .yarn/cache apps/web/.next/cache apps/web/.next/standalone

FROM node:20 AS builder-two

WORKDIR /calcom
ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000

ENV NODE_ENV=production

COPY package.json .yarnrc.yml turbo.json i18n.json ./
COPY .yarn ./.yarn
COPY --from=builder /calcom/yarn.lock ./yarn.lock
COPY --from=builder /calcom/node_modules ./node_modules
COPY --from=builder /calcom/packages ./packages
COPY --from=builder /calcom/apps/web ./apps/web
COPY --from=builder /calcom/packages/prisma/schema.prisma ./prisma/schema.prisma
COPY scripts scripts
RUN chmod +x scripts/*

# Docker's COPY flattens a directory source's *contents* into the destination,
# so a wildcard match of many package dirs (e.g. node_modules/[a-f]*) would
# merge their contents together instead of keeping each as its own directory.
# Pre-bucket with `mv` (which has no such quirk) so the runner stage can COPY
# each bucket as a single whole-directory source and keep every layer small.
# The loop (not a fixed `mv` per glob) means an empty match never breaks the
# build, and the `other` bucket is a catch-all for anything the case doesn't
# name explicitly, so a future dependency change can't silently fail this.
RUN set -e; for b in dot upper a-f g-m n-s t-z scoped-a-h scoped-i-r scoped-s-z other; do mkdir -p /nm-buckets/$b; done; \
  for e in node_modules/* node_modules/.[!.]*; do [ -e "$e" ] || [ -L "$e" ] || continue; n=${e#node_modules/}; \
    case "$n" in .*) b=dot;; [A-Z]*) b=upper;; [a-f]*) b=a-f;; [g-m]*) b=g-m;; [n-s]*) b=n-s;; [t-z]*) b=t-z;; \
      @[0-9a-h]*) b=scoped-a-h;; @[i-r]*) b=scoped-i-r;; @[s-z]*) b=scoped-s-z;; *) b=other;; esac; mv "$e" /nm-buckets/$b/; done; \
  rmdir node_modules

# Save value used during this build stage. If NEXT_PUBLIC_WEBAPP_URL and BUILT_NEXT_PUBLIC_WEBAPP_URL differ at
# run-time, then start.sh will find/replace static values again.
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL

RUN scripts/replace-placeholder.sh http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER ${NEXT_PUBLIC_WEBAPP_URL}

FROM node:20 AS runner

WORKDIR /calcom

RUN apt-get update && apt-get install -y --no-install-recommends netcat-openbsd wget && rm -rf /var/lib/apt/lists/*

# Split what used to be a single ~1.1GB COPY layer into several smaller ones.
# A single giant layer is more likely to stall mid-download on a slow/throttled
# registry blob (SBS-579). Each node_modules bucket below is a whole directory
# (see the pre-bucketing step in builder-two), so COPY nests it correctly.
COPY --from=builder-two /calcom/package.json /calcom/.yarnrc.yml /calcom/turbo.json /calcom/i18n.json /calcom/yarn.lock ./
COPY --from=builder-two /calcom/.yarn ./.yarn
COPY --from=builder-two /calcom/prisma ./prisma
COPY --from=builder-two /calcom/scripts ./scripts
COPY --from=builder-two /calcom/packages ./packages
COPY --from=builder-two /calcom/apps/web ./apps/web
COPY --from=builder-two /nm-buckets/dot ./node_modules/
COPY --from=builder-two /nm-buckets/upper ./node_modules/
COPY --from=builder-two /nm-buckets/a-f ./node_modules/
COPY --from=builder-two /nm-buckets/g-m ./node_modules/
COPY --from=builder-two /nm-buckets/n-s ./node_modules/
COPY --from=builder-two /nm-buckets/t-z ./node_modules/
COPY --from=builder-two /nm-buckets/scoped-a-h ./node_modules/
COPY --from=builder-two /nm-buckets/scoped-i-r ./node_modules/
COPY --from=builder-two /nm-buckets/scoped-s-z ./node_modules/
COPY --from=builder-two /nm-buckets/other ./node_modules/
ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=30s --retries=5 \
  CMD wget --spider http://localhost:3000 || exit 1

CMD ["/calcom/scripts/start.sh"]
