FROM node:22-slim AS base
# better-sqlite3 compiles from source when no prebuild matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV IN_DOCKER=1
ENV PORT=4333
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/app/data
ENV DB_PATH=/app/data/freejarvis.db
ENV SOUL_PATH=/app/data/SOUL.md
ENV WORKSPACE_DIR=/app/data/workspace

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Next's file tracing follows JavaScript imports, and better-sqlite3's actual
# work happens in a compiled .node addon that no import statement mentions.
# The traced copy arrives with its wrapper and without the binary, and the app
# then dies on the first query rather than at boot. Copy the package whole.
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

RUN mkdir -p /app/data/workspace
EXPOSE 4333

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4333/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.js"]
