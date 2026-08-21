# ============================================================
# MT5 Bridge — Production Dockerfile
# Bridges FINEX app to MetaTrader 5 Terminal via EA
# ============================================================

FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies (no lock file for this minimal service)
COPY package.json ./
RUN bun install --production 2>/dev/null || true

# Copy source
COPY index.ts .
COPY FRXAI_EA.mq5 /app/ea/

# Create non-root user
RUN adduser -D -u 1001 mt5user && chown -R mt5user:mt5user /app
USER mt5user

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3004/api/status || exit 1

EXPOSE 3004

# Production: no --hot
ENTRYPOINT ["bun", "index.ts"]
