FROM node:22-slim AS base
WORKDIR /app/website

FROM base AS deps
COPY website/package.json website/package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/website/node_modules ./node_modules
COPY website/ ./
COPY data/ ../data/
COPY website/.env .env
RUN ls -la /app/data/ || echo "NO /app/data"; ls -la /app/ || echo "NO /app"
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/website/.next/standalone ./
COPY --from=builder /app/website/.next/static ./.next/static
COPY --from=builder /app/website/public ./public
COPY --from=builder /app/website/server ./server
COPY --from=builder /app/website/src/lib ./src/lib
COPY --from=builder /app/data ./data
COPY --from=builder /app/website/node_modules ./node_modules
COPY --from=builder /app/website/package.json ./package.json
COPY --from=builder /app/website/tsconfig.json ./tsconfig.json
COPY --from=builder /app/website/next.config.ts ./next.config.ts

ENV PORT=3003
ENV RACE_WS_PORT=3004
ENV PGHOST=racemind-db
ENV PGPORT=5432
ENV PGDATABASE=racemind
ENV PGUSER=racemind
ENV PGPASSWORD=racemind

EXPOSE 3003 3004

CMD ["node", "server.js"]
