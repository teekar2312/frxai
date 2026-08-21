This document describes how to deploy FINEX Indonesia v2.3.0 to production, staging, and local development environments. Three deployment strategies are supported: containerized production via Docker Compose (recommended), a lightweight Docker-based development setup, and a manual bare-metal approach. Follow the section that matches your target environment.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deployment Options Overview](#deployment-options-overview)
- [Production Deployment (Docker Compose)](#production-deployment-docker-compose)
- [Development Deployment](#development-deployment)
- [Local Deployment on Windows 11 + VS Code](#local-deployment-on-windows-11--vs-code)
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
| Windows 11 + VS Code | Local development on Windows | None | None (dev mode) |
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

## Local Deployment on Windows 11 + VS Code

This section covers setting up the full development environment on a Windows 11 machine using Visual Studio Code as the IDE. Two approaches are available: native Windows (using Bun for Windows) or WSL2 (recommended for best compatibility with the Linux-based Dockerfiles and shell scripts).

### Prerequisites

| Dependency | Version | Purpose | Installation |
|---|---|---|---|
| Windows 11 | 22H2 or later | Host operating system | Windows Update or Microsoft download |
| WSL2 | 2.x (recommended) | Linux compatibility layer for Docker and build tools | `wsl --install` in PowerShell as Administrator |
| Ubuntu (WSL distro) | 22.04 or 24.04 | Linux distribution inside WSL2 | `wsl --install -d Ubuntu` (installed automatically with WSL2 by default) |
| Docker Desktop | 4.29+ | Container runtime with WSL2 backend | https://www.docker.com/products/docker-desktop/ |
| Git for Windows | 2.43+ | Version control | https://git-scm.com/download/win or `winget install Git.Git` |
| Visual Studio Code | 1.90+ | IDE | https://code.visualstudio.com/ or `winget install Microsoft.VisualStudioCode` |
| Bun | 1.x | JavaScript runtime and package manager | `powershell -c "irm bun.sh/install.ps1 | iex"` (Windows native) or `curl -fsSL https://bun.sh/install | bash` (WSL2) |
| Node.js | 20 LTS (fallback) | Required by some Prisma tooling | Installed automatically by Bun; no separate install needed in most cases |
| OpenSSL | 3.x | Generate secrets (NEXTAUTH_SECRET, API_SECRET_KEY) | Bundled with Git for Windows (`C:\Program Files\Git\usr\bin\openssl.exe`) or WSL2 system package |

**VS Code Extensions (recommended):**

| Extension | ID | Purpose |
|---|---|---|
| ESLint | `dbaeumer.vscode-eslint` | Real-time linting for TypeScript/JavaScript |
| Prisma | `Prisma.prisma-vscode` | Syntax highlighting, format, and IntelliSense for `.prisma` files |
| Docker | `ms-azuretools.vscode-docker` | Manage containers, compose files, and images |
| WSL | `ms-vscode-remote.remote-wsl` | Open WSL2 projects directly from VS Code on Windows |
| GitLens | `eamodio.gitlens` | Git history, blame, and repository visualization |
| Error Lens | `usernamehw.errorlens` | Inline display of diagnostics (errors/warnings) |
| Tailwind CSS IntelliSense | `bradlc.vscode-tailwindcss` | Autocomplete for Tailwind utility classes |
| Prettier | `esbenp.prettier-vscode` | Opinionated code formatter (optional) |

### Approach A -- WSL2 (Recommended)

WSL2 provides a near-native Linux environment, which ensures full compatibility with the project's shell scripts, Dockerfiles, and `prisma db push` commands.

#### Step 1 -- Install WSL2 and Ubuntu

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

Restart Windows when prompted. After reboot, Ubuntu launches automatically. Set a username and password for the WSL user.

Verify the installation:

```bash
wsl --version                        # should show WSL 2.x
wsl -l -v                           # should show Ubuntu with version 2
```

#### Step 2 -- Install Docker Desktop with WSL2 backend

1. Download and install Docker Desktop from https://www.docker.com/products/docker-desktop/
2. Launch Docker Desktop, open **Settings > General**, and enable:
   - "Use the WSL 2 based engine"
3. Open **Settings > Resources > WSL Integration**, enable integration with Ubuntu.
4. Restart Docker Desktop.

Verify from WSL2:

```bash
docker --version         # Docker version 27.x+
docker compose version  # Docker Compose version v2.x+
```

#### Step 3 -- Install Bun in WSL2

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version           # should show 1.x
```

#### Step 4 -- Open the project in VS Code

```bash
# From WSL2 terminal:
cd ~
git clone https://github.com/teekar2312/frxai.git
cd frxai
bun install
code .                  # opens VS Code with WSL remote extension
```

When VS Code opens, it detects the WSL2 environment and prompts to install the **WSL** extension. Accept the prompt. VS Code then runs the remote server inside WSL2, giving you full Linux tooling with the Windows UI.

#### Step 5 -- Configure the environment

```bash
cp .env.example .env
```

Open `.env` in VS Code and set at minimum:

```env
NEXTAUTH_SECRET=   # generate: openssl rand -hex 32
API_SECRET_KEY=    # generate: openssl rand -hex 32
```

Optionally add `FINNHUB_API_KEY` and `GROQ_API_KEY` for live data.

#### Step 6 -- Initialize the database

```bash
bun run db:push
```

#### Step 7 -- Start the development server

```bash
bun run dev
```

Open `http://localhost:3000` in your browser on Windows. The WSL2 port forwarding makes this work transparently.

#### Step 8 -- Start mini-services (optional)

Open separate VS Code terminals (Ctrl+` backtick, then click the "+" in the terminal panel) and run:

```bash
# Terminal 1 -- WebSocket price feed
cd mini-services/ws-prices && bun install && bun --hot index.ts

# Terminal 2 -- MT5 bridge
cd mini-services/mt5-bridge && bun install && bun --hot index.ts
```

#### VS Code task for quick start (optional)

Create `.vscode/tasks.json` in the project root to add a one-click start task:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "FINEX -- Start Dev Server",
      "type": "shell",
      "command": "bun run dev",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "presentation": {
        "reveal": "always",
        "panel": "dedicated"
      },
      "problemMatcher": []
    },
    {
      "label": "FINEX -- Start ws-prices",
      "type": "shell",
      "command": "cd mini-services/ws-prices && bun install && bun --hot index.ts",
      "presentation": {
        "reveal": "always",
        "panel": "dedicated"
      },
      "problemMatcher": []
    },
    {
      "label": "FINEX -- Start mt5-bridge",
      "type": "shell",
      "command": "cd mini-services/mt5-bridge && bun install && bun --hot index.ts",
      "presentation": {
        "reveal": "always",
        "panel": "dedicated"
      },
      "problemMatcher": []
    },
    {
      "label": "FINEX -- Lint",
      "type": "shell",
      "command": "bun run lint",
      "group": "test",
      "problemMatcher": "$eslint-stylish"
    }
  ]
}
```

Run tasks with **Terminal > Run Task...** (Ctrl+Shift+B runs the default build task, which is the dev server).

### Approach B -- Native Windows (Without WSL2)

Use this if WSL2 is not available. Some features may require adjustment.

#### Step 1 -- Install dependencies

1. Install Git for Windows from https://git-scm.com/download/win -- during setup, select "Git from the command line and also from 3rd-party software" to ensure `git` is in PATH.
2. Install Bun for Windows. Open **PowerShell** and run:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

3. Verify:

```powershell
git --version
bun --version
```

#### Step 2 -- Install Docker Desktop

Same as WSL2 Step 2 above. Docker Desktop on Windows works with or without WSL2.

#### Step 3 -- Clone and set up

```powershell
git clone https://github.com/teekar2312/frxai.git
cd frxai
bun install
copy .env.example .env
```

#### Step 4 -- Configure and start

1. Open the project folder in VS Code: `code .`
2. Edit `.env` and set `NEXTAUTH_SECRET` and `API_SECRET_KEY`.
   Generate secrets using Git Bash (bundled with Git for Windows):

```bash
# In Git Bash:
openssl rand -hex 32
```

3. Initialize the database:

```powershell
bun run db:push
```

4. Start the development server:

```powershell
bun run dev
```

5. Open `http://localhost:3000` in your browser.

#### Known limitations on native Windows

- The `docker-entrypoint.sh` script uses `#!/bin/sh` (Unix line endings). Docker handles this internally, so it only affects local script execution.
- The `scripts/backup-db.sh` and `.zscripts/*.sh` scripts require Git Bash or WSL2.
- File system watching (Next.js hot reload) may be slower on native Windows NTFS compared to WSL2's ext4. If you experience slow refreshes, switch to the WSL2 approach.
- The `bun --hot` flag for mini-services works on Windows but file events may lag.

### VS Code Workspace Tips

**Recommended settings** -- create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "files.associations": {
    "*.prisma": "prisma"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "tailwindCSS.includeLanguages": {
    "typescript": "javascript",
    "typescriptreact": "javascript"
  }
}
```

**Useful VS Code keybindings for this project:**

| Shortcut | Action |
|---|---|
| `Ctrl+` ` (backtick) | Toggle integrated terminal |
| `Ctrl+Shift+B` | Run default build task (dev server) |
| `Ctrl+Shift+P` > "Tasks: Run Task" | Pick a task (lint, ws-prices, mt5-bridge) |
| `Ctrl+P` | Quick file open -- type `@` then function name to search symbols |
| `Ctrl+` ` (click on import) | Go to definition (jump to component/lib) |
| `F12` | Go to definition alternative |
| `Shift+Alt+F` | Format document |
| `Ctrl+Shift+M` | Open problems panel (ESLint errors/warnings) |

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
