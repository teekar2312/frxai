This document describes how to deploy FINEX Indonesia v2.3.0 to production, staging, and local development environments. Three deployment strategies are supported: containerized production via Docker Compose (recommended), a lightweight Docker-based development setup, and a manual bare-metal approach. Follow the section that matches your target environment.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deployment Options Overview](#deployment-options-overview)
- [Production Deployment (Docker Compose)](#production-deployment-docker-compose)
- [Development Deployment](#development-deployment)
- [Manual / Bare-Metal Deployment](#manual--bare-metal-deployment)
- [Environment Variables Reference](#environment-variables-reference)
- [Health Checks](#health-checks)
- [Update Procedure](#update-procedure)
- [Backup and Recovery](#backup-and-recovery)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Details |
|---|---|
| Bun runtime | Bun 1.x -- https://bun.sh |
| Docker | Docker Engine 20.x or later |
| Docker Compose | Docker Compose v2 (plugin or standalone) |
| Domain name | A public domain with a DNS A record pointing to your server (required for HTTPS via Caddy and Let's Encrypt) |
| API keys | At minimum `NEXTAUTH_SECRET` and `API_SECRET_KEY`. Recommended: `FINNHUB_API_KEY`, `GROQ_API_KEY` |

---

## Deployment Options Overview

| Option | Use Case | TLS | Reverse Proxy |
|---|---|---|---|
| Docker Compose (production) | Recommended for live servers | Caddy with auto-TLS | Built-in Caddy |
| Docker Compose (development) | Local development with containers | None | None (direct access) |
| Manual / bare metal | Air-gapped or custom infra | Self-managed | Self-managed (Caddy or nginx) |

---

## Production Deployment (Docker Compose)

### Step 1 -- Clone the repository

```bash
git clone https://github.com/teekar2312/frxai.git
cd frxai
```

### Step 2 -- Create the environment file

```bash
cp .env.example .env.production
```

Open `.env.production` and set the following variables.

**Required:**

```env
NEXTAUTH_SECRET=   # generate with: openssl rand -hex 32
API_SECRET_KEY=    # generate with: openssl rand -hex 32
FINEX_DOMAIN=      # your public domain, e.g. app.finex.id
CADDY_ADMIN_EMAIL= # email for Let's Encrypt certificate notifications
```

**Optional but recommended:**

```env
FINNHUB_API_KEY=
GROQ_API_KEY=                  # best free AI provider
RESEND_API_KEY=
NOTIFICATION_EMAIL_FROM=
NOTIFICATION_EMAIL_TO=
ALLOW_REGISTRATION=false        # set true only during initial user onboarding
```

### Step 3 -- Build and deploy

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The production overlay (`docker-compose.prod.yml`) adds the following:

- Caddy reverse proxy listening on ports 80 and 443 with automatic TLS via Let's Encrypt
- Health-check dependencies so Caddy only starts after the application reports healthy
- Resource limits: app container capped at 1 GB RAM / 1 CPU; Caddy at 256 MB; ws-prices at 128 MB
- Internal Docker networking with no ports exposed to the host except 80/443 through Caddy
- Non-root container user for the application

### Step 4 -- Verify the deployment

```bash
# Check that all containers are running
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Confirm the health endpoint responds
curl http://localhost/api/health
```

A successful response looks like:

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "ai_providers": "ok"
  }
}
```

### Step 5 -- Create the admin user

1. Set `ALLOW_REGISTRATION=true` in `.env.production`.
2. Restart the stack: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
3. Open `https://<FINEX_DOMAIN>/register` and create the admin account.
4. Set `ALLOW_REGISTRATION=false` in `.env.production` and restart again.
5. Promote the new user to the `admin` role via the database or the internal API.

### Optional -- Enable the MT5 bridge

The MT5 bridge runs as an optional profile. To include it in the deployment:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile mt5 up -d --build
```

---

## Development Deployment

### Step 1 -- Clone and install dependencies

```bash
git clone https://github.com/teekar2312/frxai.git
cd frxai
bun install
```

### Step 2 -- Configure the environment

```bash
cp .env.example .env
```

Fill in at least `NEXTAUTH_SECRET` and `API_SECRET_KEY`.

### Step 3 -- Initialize the database

```bash
bun run db:push
```

### Step 4 -- Start the development server

```bash
bun run dev
```

The application is available at `http://localhost:3000`.

### Step 5 -- Start optional mini-services

Run each in a separate terminal or background them:

```bash
# WebSocket price feed
cd mini-services/ws-prices && bun install && bun --hot index.ts &

# MT5 bridge
cd mini-services/mt5-bridge && bun install && bun --hot index.ts &
```

---

## Manual / Bare-Metal Deployment

Use this approach when you cannot run Docker or need full control over the runtime environment.

```bash
# 1. Install Bun 1.x from https://bun.sh

# 2. Export the production environment
export NODE_ENV=production

# 3. Install dependencies (dev dependencies needed for the build step)
bun install --production=false

# 4. Synchronize the database schema
bun run db:push
#   or, for migration-based workflows:
#   bun run db:migrate:deploy

# 5. Build the production bundle
bun run build

# 6. Start the server (uses Node.js for runtime stability)
bun run start
```

**Reverse proxy and TLS**

Set up Caddy or nginx in front of the application on port 3000. If you use Caddy, copy the security headers from `Caddyfile.production`. If you use nginx, replicate those headers in your server block. Obtain a TLS certificate via Let's Encrypt -- either through Caddy's automatic provisioning or `certbot`.

---

## Environment Variables Reference

| Variable | Default | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | `file:./db/custom.db` | No | SQLite database path |
| `NEXTAUTH_SECRET` | -- | Yes | Cryptographic secret for NextAuth.js sessions |
| `API_SECRET_KEY` | -- | Yes (prod) | Secret for authenticating internal API calls |
| `ALLOW_REGISTRATION` | `false` | No | Set `true` to open public registration |
| `FINEX_DOMAIN` | -- | Yes (Docker prod) | Public domain for Caddy and absolute URLs |
| `CADDY_ADMIN_EMAIL` | -- | Yes (Docker prod) | Email for Let's Encrypt notifications |
| `PORT` | `3000` | No | Application listen port |
| `LOG_LEVEL` | `info` | No | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `FINNHUB_API_KEY` | -- | No | Finnhub API key for market data |
| `MARKETAUX_API_KEY` | -- | No | Marketaux API key for market news |
| `GROQ_API_KEY` | -- | No | Groq API key (recommended free AI provider) |
| `OPENAI_API_KEY` | -- | No | OpenAI API key for AI analysis |
| `TOGETHER_API_KEY` | -- | No | Together AI API key |
| `TINYFISH_API_KEY` | -- | No | Tinyfish API key |
| `LOKAL_AI_BASE_URL` | -- | No | Base URL for a self-hosted LLM |
| `MT5_BRIDGE_URL` | -- | No | URL of the MT5 bridge service |
| `MT5_BRIDGE_SECRET` | -- | No | Shared secret for MT5 bridge authentication |
| `RESEND_API_KEY` | -- | No | Resend API key for email delivery |
| `NOTIFICATION_EMAIL_FROM` | -- | No | Sender address for notification emails |
| `NOTIFICATION_EMAIL_TO` | -- | No | Recipient address for notification emails |
| `WS_PRICES_URL` | -- | No | URL of the WebSocket price service |

---

## Health Checks

| Service | Endpoint | Expected Response |
|---|---|---|
| Application | `GET /api/health` | `{ "status": "healthy", "checks": { "database": "ok", "ai_providers": "ok" } }` |
| WebSocket prices | `GET http://localhost:3005/api/status` | Service status payload |
| MT5 bridge | `GET http://localhost:3004/api/status` | Service status payload |

In the Docker Compose production setup, Caddy depends on the application health check. If the `/api/health` endpoint does not return `healthy`, Caddy will not start serving traffic.

---

## Update Procedure

```bash
# 1. Pull the latest code
git pull origin main

# 2. Rebuild and restart all services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 3. Verify the new containers are healthy
docker compose logs app --tail=50
```

Database schema changes are applied automatically by the container entrypoint script (`prisma db push`). No manual migration step is needed for updates.

---

## Backup and Recovery

The application uses SQLite. The database file lives at `/app/data/custom.db` inside the container and is persisted to the Docker volume named `finex-data`.

**Ad-hoc backup:**

```bash
docker cp finex-app:/app/data/custom.db backup-$(date +%Y%m%d).sql
```

**Automated backups:**

A helper script is provided at `scripts/backup-db.sh`. Configure it with your preferred schedule using cron:

```bash
# Run daily at 02:00
0 2 * * * /path/to/scripts/backup-db.sh
```

**Restore:**

```bash
docker cp backup-20250701.sql finex-app:/app/data/custom.db
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart app
```

---

## Troubleshooting

### Container fails to start

```bash
docker compose logs app
```

Most commonly caused by missing required environment variables. Verify that `.env.production` contains `NEXTAUTH_SECRET`, `API_SECRET_KEY`, `FINEX_DOMAIN`, and `CADDY_ADMIN_EMAIL`.

### 503 on /api/health

A 503 response indicates the database connection failed. Check that the `finex-data` volume is mounted correctly and the SQLite file exists inside the container.

### Caddy TLS / certificate errors

1. Confirm that your DNS A record points to the server's public IP address.
2. Verify that `CADDY_ADMIN_EMAIL` is set to a valid email.
3. Ensure ports 80 and 443 are open in your firewall and not used by another process.

### HTTP 429 -- Rate limit exceeded

The API enforces rate limits. Wait for the duration specified in the `Retry-After` response header before retrying.

### AI analysis returns errors

1. Confirm that at least one AI provider API key is set in your environment (`GROQ_API_KEY`, `OPENAI_API_KEY`, etc.).
2. Check provider availability by calling `GET /api/ai-providers` and reviewing the response.
