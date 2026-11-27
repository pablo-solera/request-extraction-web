FROM oven/bun:1.4@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.4@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# One-shot image that sets the database up on a deployment (`bun run db:deploy`): it applies the migrations and creates the
# users of the test accounts, if enabled. The standalone runtime has neither drizzle-kit nor the sources.
FROM oven/bun:1.4@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS migrate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY db ./db
COPY lib ./lib
COPY scripts ./scripts
CMD ["bun", "run", "db:deploy"]

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient \
    LD_LIBRARY_PATH=/opt/oracle/instantclient

ARG INSTANTCLIENT_ZIP=instantclient-basiclite-linux.x64-21.13.0.0.0dbru.zip
ARG INSTANTCLIENT_URL=https://download.oracle.com/otn_software/linux/instantclient/2113000/${INSTANTCLIENT_ZIP}
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip libaio1 \
    && mkdir -p /opt/oracle \
    && curl -fsSL -o /tmp/instantclient.zip "${INSTANTCLIENT_URL}" \
    && unzip -q /tmp/instantclient.zip -d /opt/oracle \
    && mv /opt/oracle/instantclient_* /opt/oracle/instantclient \
    && rm -f /tmp/instantclient.zip \
    && apt-get purge -y curl unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
