# Our 52 — single all-in-one image: builds the web app, then the Fastify API
# serves both the API and the built frontend from one process (one Railway
# service, one domain, one SQLite volume). The client uses relative /api paths,
# so same-origin needs no proxy or CORS.

# --- Stage 1: build the web bundle ---
FROM node:22-bookworm-slim AS webbuild
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @our52/web... --prod=false --frozen-lockfile
COPY apps/web ./apps/web
RUN pnpm --filter @our52/web build

# --- Stage 2: server runtime (also serves the web bundle) ---
FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# openssl keeps Prisma from warning about libssl detection at runtime.
RUN corepack enable && apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --filter @our52/server... --prod=false --frozen-lockfile

COPY apps/server ./apps/server
RUN pnpm --filter @our52/server exec prisma generate

# Bring in the built web app so the API can serve it (resolved as ../../web/dist).
COPY --from=webbuild /app/apps/web/dist ./apps/web/dist

WORKDIR /app/apps/server
EXPOSE 4000

# Production runtime defaults. NODE_ENV=production makes isProd true so the
# session cookie ships with Secure (it otherwise defaults to development and the
# cookie is sent over plain HTTP). WHATSAPP_SESSION_DIR points at the mounted
# Railway Volume (/data) so paired Baileys creds survive redeploys instead of
# living on ephemeral container storage. Both can still be overridden by env.
ENV NODE_ENV=production
ENV WHATSAPP_SESSION_DIR=/data/whatsapp

# Applies migrations, seeds the couple (idempotent), then starts the API — which
# also serves the frontend and runs the scheduling worker inline (RUN_WORKER).
CMD ["pnpm", "start:prod"]
