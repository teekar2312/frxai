FROM oven/bun:1-alpine AS base
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production
COPY index.ts .
RUN adduser -D -u 1001 wsuser && chown -R wsuser:wsuser /app
USER wsuser
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3005/api/status || exit 1
EXPOSE 3005
ENTRYPOINT ["bun", "index.ts"]
