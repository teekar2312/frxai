FINEX Indonesia is an AI-powered forex trading dashboard designed for the Indonesian market. It provides real-time price streaming, automated trade execution, multi-provider AI analysis, and full MetaTrader 5 integration within a modern single-page application. This document describes the system architecture, data flows, security model, and operational details for version 2.3.0.

---

## Architecture Overview

The system follows a monorepo architecture with three runtime processes coordinated through HTTP and WebSocket protocols. All services are containerized and communicate internally through a Caddy reverse proxy in production.

| Component | Port | Runtime | Purpose |
|-----------|------|---------|--------|
| Next.js App | 3000 | Node.js | Main application, API routes, SSR |
| ws-prices | 3005 | Bun | WebSocket price streaming mini-service |
| mt5-bridge | 3004 | Bun | MetaTrader 5 integration mini-service |
| Caddy | 80/443 | Caddy | Reverse proxy, TLS termination, rate limiting |

### Inter-Process Communication

```
Browser <--HTTP/WS--> Caddy <--HTTP/WS--> Next.js (port 3000)
                                         |
                                         +-- HTTP (GET /api/prices) --> ws-prices (port 3005)
                                         +-- HTTP REST (orders, positions) --> mt5-bridge (port 3004)

MT5 Terminal <--EA (MQL5)--> mt5-bridge (port 3004)
  POST /ea/sync (polling) + WebSocket (ws://bridge:3004/ws)
```

- **Browser to Next.js**: HTTP/REST for API calls and native WebSocket for live price streaming (Socket.IO-style pattern).
- **Next.js to ws-prices**: HTTP polling via `GET /api/prices` or internal WebSocket connection for real-time price data.
- **Next.js to mt5-bridge**: HTTP REST calls for order management, position queries, and account information.
- **MT5 Terminal to mt5-bridge**: The MQL5 Expert Advisor communicates via HTTP polling (`POST /ea/sync`) and a persistent WebSocket connection (`ws://bridge:3004/ws`).

Next.js routes requests to mini-services through Caddy using an `XTransformPort` query parameter on internal calls. Caddy inspects this parameter and proxies the request to the appropriate mini-service port (3004 or 3005), keeping all traffic behind the reverse proxy.

---

## Runtime Processes

### 1. Next.js Application (Port 3000)

The primary application server built on Next.js 16 with the App Router. It handles server-side rendering of all page routes, 42 API route handlers under `src/app/api/`, the embedded trading engine scheduler, authentication session management via NextAuth.js, and middleware for security headers, auth guards, and CSP enforcement.

### 2. ws-prices Mini-Service (Port 3005)

A lightweight Bun-based service responsible for maintaining live forex price feeds from external data providers (Finnhub), exposing price data via HTTP endpoint (`GET /api/prices`), broadcasting price updates to connected WebSocket clients, and managing pair discovery and subscriptions.

### 3. mt5-bridge Mini-Service (Port 3004)

A Bun-based integration layer for MetaTrader 5 providing a REST API for order placement, modification, and cancellation; position and pending order management; account information retrieval (balance, equity, margin, free margin); a WebSocket endpoint for bidirectional real-time sync with the MT5 EA; and an EA sync endpoint (`POST /ea/sync`) for state reconciliation.

---

## Request Flow

### Standard Browser Request

```
1. Browser -> HTTP request
2. Caddy (port 80/443) -> TLS termination, rate limit check
3. Caddy -> Proxy to Next.js (port 3000)
4. Next.js -> Middleware (auth, security headers, CSP)
5. Next.js -> Route handler -> Business logic
6. Route handler -> Prisma/SQLite (data) or HTTP (mini-service)
7. Response -> Caddy -> Browser
```

### Mutation Endpoint Protection

All mutation endpoints (POST, PUT, PATCH, DELETE) are protected by `validateAuth()`, which checks for an `x-api-key` header or Bearer token containing a valid `API_SECRET_KEY`, validated via `crypto.timingSafeEqual` to prevent timing attacks.

---

## Authentication and Authorization

The system employs a dual authentication mechanism to serve both API consumers and web UI users.

### Web UI Authentication (NextAuth.js v4)

- **Provider**: Credentials-based login with username/email and password
- **Session**: JWT tokens stored in HTTP-only cookies, 8-hour lifetime (`maxAge: 28800`)
- **Protection scope**: All page routes (`/`) and dashboard API read endpoints

### API Authentication (API Secret Key)

- **Header**: `x-api-key` or `Authorization: Bearer <key>`
- **Validation**: Timing-safe comparison against `API_SECRET_KEY` environment variable
- **Protection scope**: All trading mutation endpoints (orders, positions, configuration)
- **No hardcoded fallback keys**: Validation fails closed when `API_SECRET_KEY` is unset

### Two-Factor Authentication (TOTP)

- **Library**: `otplib` for TOTP generation and verification
- **Enforcement**: Optional per-user, enforced at login when enabled
- **Storage**: `UserTwoFactor` model stores the secret key and enabled flag
- **Recovery**: QR code provisioning during setup via `qrcode` library

### Middleware Auth Guards

The Next.js middleware redirects unauthenticated users to `/login`, allows public routes (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/legal/*`, API auth routes), and validates the NextAuth session for protected routes before rendering.

---

## Data Layer

- **Engine**: SQLite via `better-sqlite3` driver
- **ORM**: Prisma ORM with schema-first approach
- **Storage**: Single-file database (`custom.db`) — production at `/app/data/custom.db` (Docker volume), local dev at `/db/custom.db`
- **Development**: Prisma migrations for version-controlled schema changes
- **Production**: `prisma db push` executed by the Docker entrypoint script on first start; no migration files, schema synced directly from `schema.prisma`

### Data Models (16)

| Model | Purpose |
|-------|--------|
| `User` | User accounts, credentials, preferences |
| `UserTwoFactor` | TOTP secrets and 2FA enablement |
| `TradingPosition` | Open and closed trading positions |
| `PendingOrder` | Limit, stop, and other pending orders |
| `PriceAlert` | User-defined price alert rules |
| `ActivityLog` | Audit trail for all trading activity |
| `AiAnalysis` | Stored AI analysis results and recommendations |
| `BacktestResult` | Historical backtest execution results |
| `NewsItem` | Cached and fetched forex news articles |
| `TradingConfig` | Per-user and global trading configuration |
| `Notification` | In-app notification queue |
| `EconomicEvent` | Economic calendar events |
| `WatchlistPair` | User watchlist entries |
| `SharedSignal` | Community-shared trading signals |
| `SignalComment` | Comments on shared signals |
| `Transaction` | Financial transaction records |

---

## Trading Engine

The trading engine is a server-side scheduler embedded within the `/api/finnhub` API route handler. It operates on a tick-based system driven by incoming price data at 5-second intervals.

### Key Processes

| Process | Frequency | Description |
|---------|-----------|-------------|
| Price tick | Every 5s | Receives and processes new price data |
| SL/TP check | Every tick | Evaluates stop-loss and take-profit conditions for all open positions |
| Pending order check | Every tick | Evaluates whether pending orders should be activated |
| Auto-execute | Every 30s (6th tick) | Executes AI-generated signals when auto-trading is enabled |
| Trailing stop | Every 50s (10th tick) | Adjusts stop-loss levels for positions with trailing stops |

### Safety Checks (Auto-Execute)

Before executing any AI-recommended trade, the engine validates: **maxOpenPositions** (prevents exceeding configured position limit), **dailyRiskLimit** (blocks trades that would breach cumulative daily risk), **avoidNewsTrading** (checks `EconomicEvent` for high-impact events within a configurable window), and **spread validation** (compares current spread against a maximum threshold to prevent execution during illiquid conditions).

### Balance Synchronization

`applyPnlToBalance()` is invoked on every position close event — whether triggered by stop-loss, take-profit, manual close, or stop-out (margin call) — ensuring the database balance stays in sync with the MT5 terminal at all times.

---

## AI System

### Multi-Provider Architecture

The AI subsystem is built on a provider abstraction layer defined in `ai-provider.ts` with a single unified interface:

```typescript
generateAiCompletion(prompt: string, providerId: string, modelId: string): Promise<string>
```

| Provider | Identifier | Default | Notes |
|----------|-----------|---------|-------|
| ZAI | `zai` | Yes | z-ai-web-dev-sdk integration |
| Groq | `groq` | No | Low-latency inference |
| OpenAI | `openai` | No | GPT-series models |
| Together AI | `together` | No | Open-source model hosting |
| Tinyfish.ai | `tinyfish` | No | Specialized trading models |
| Lokal AI | `lokal` | No | Ollama-based local inference |

The active provider is determined by the `TradingConfig.aiProvider` field stored in the database, allowing per-deployment or per-user provider selection.

### Analysis Pipeline

AI analysis is generated from a composite prompt including: **30+ technical indicators** (SMA, EMA, RSI, MACD, Bollinger Bands, Stochastic, ATR, ADX, Ichimoku, Fibonacci, pivot points, volume), **recent news** (cached `NewsItem` records), **market condition** (volatility regime, trend direction, session), and **pair context** (historical performance, open positions, pending orders). The news matching system uses an OR-based query to capture both directly tagged and untagged news items for broader market context.

---

## Rate Limiting

### Application-Level (In-Memory Sliding Window)

Defined in `src/lib/rate-limit.ts` with automatic cleanup every 5 minutes.

| Bucket | Limit | Window | Applies To |
|--------|-------|--------|------------|
| `auth` | 10 | 1 min | Login, register, password reset |
| `trade` | 10 | 1 min | Order placement, modification, cancellation |
| `analysis` | 5 | 1 min | AI analysis generation |
| `indicators` | 10 | 1 min | Technical indicator calculations |
| `finnhub` | 12 | 1 min | Price data and market data endpoints |
| `news` | 3 | 1 min | News fetching and refresh |
| `general` | 60 | 1 min | All other API endpoints |

### Infrastructure-Level (Caddy)

Caddy provides a second layer: global 200 requests/second, API routes 30 requests/second, and auth routes 5 requests per 60 seconds.

---

## Security

### Middleware Security Headers

| Header | Purpose |
|--------|---------|
| `Content-Security-Policy` | Prevents XSS, restricts resource loading (no `unsafe-eval`, HTTPS/WSS only for `connect-src`) |
| `Strict-Transport-Security` | Forces HTTPS connections |
| `X-Frame-Options` | Prevents clickjacking (DENY) |
| `X-Content-Type-Options` | Prevents MIME-type sniffing (nosniff) |

### Additional Security Measures

- **Passwords**: `bcryptjs` hashing with adaptive cost factor; no plaintext storage or logging
- **API keys**: Timing-safe comparison via `crypto.timingSafeEqual`; no hardcoded fallbacks; not logged or included in error responses
- **Transport**: Caddy provides automatic TLS via Let's Encrypt; all external connections use HTTPS/WSS; internal container traffic uses plain HTTP within the isolated Docker network

---

## Frontend Architecture

The frontend is a single-page application served on the `/` route with a tabbed dashboard interface. Navigation between trading panels is handled client-side without full page reloads.

### Trading Panels (22)

All panels reside in `src/components/trading/` and include: `DashboardPanel` (account overview, PnL summary), `ChartPanel` (interactive price charts with technical indicators), `LiveTradingPanel` (manual order entry), `AiAnalysisPanel` (AI analysis display and configuration), `PositionsPanel` (open positions with real-time PnL), `PendingOrdersPanel`, `HistoryPanel`, `NewsPanel`, `AlertsPanel`, `BacktestPanel`, `SignalsPanel`, `WatchlistPanel`, `EconomicCalendarPanel`, `NotificationsPanel`, `SettingsPanel`, `ActivityLogPanel`, `RiskManagementPanel`, `TransactionsPanel`, `AccountPanel`, `IndicatorPanel`, `PairAnalysisPanel`, and `SharedSignalDetailPanel`. Shared types and utilities are in `shared.ts`.

### State Management

- **Zustand Store** (`trading-store.ts`): Global trading state with `localStorage` persistence for `selectedPair`, `activeTab`, `quotes`, `autoTrading`, and `serverConfig`; non-persisted fields for real-time price updates and UI transient state
- **Server State**: Direct `fetch` calls to API route handlers; TanStack Query is available but not actively used; WebSocket connection for real-time price streaming bypasses the REST layer

### Internationalization (i18n)

225+ translation keys in `i18n.ts`; Indonesian (`id`) is the default language, English (`en`) is secondary. Language preference is stored in the Zustand store with `localStorage` persistence. Uses a lightweight custom `t()` function without an external i18n library.

### Visual Design

Dark trading terminal aesthetic with `zinc-950` background, `emerald` accents for positive sentiment, `red` for losses. Built with shadcn/ui (New York style), Lucide React icons, and Sonner toasts. Mobile-first responsive design with Sheet-based sidebar on mobile and CSS Grid breakpoints.

---

## File Structure

```
project-root/
+-- src/
|   +-- app/
|   |   +-- api/                  # 42 API route handlers
|   |   +-- login/                # Login page
|   |   +-- register/             # Registration page
|   |   +-- forgot-password/      # Password recovery request
|   |   +-- reset-password/       # Password reset execution
|   |   +-- legal/                # Legal pages (terms, privacy, etc.)
|   |   +-- layout.tsx            # Root layout with providers
|   |   +-- page.tsx              # Main dashboard (SPA entry)
|   |   +-- middleware.ts         # Auth guards, security headers, CSP
|   +-- components/
|   |   +-- trading/              # 22 trading panels + shared.ts
|   |   +-- ui/                   # shadcn/ui primitives
|   +-- lib/                     # 20 utility modules (ai-provider, rate-limit, etc.)
|   +-- hooks/                   # 3 custom React hooks
+-- prisma/
|   +-- schema.prisma             # Database schema (16 models)
|   +-- migrations/               # Version-controlled schema changes
+-- mini-services/
|   +-- ws-prices/                # Bun price streaming service
|   +-- mt5-bridge/               # Bun MT5 integration service
+-- public/                       # Static assets
+-- Dockerfile                    # Multi-stage build
+-- docker-compose.yml            # Development compose
+-- docker-compose.prod.yml       # Production overlay
+-- Caddyfile                     # Reverse proxy configuration
+-- package.json
+-- bun.lockb / bunfig.toml
```

---

## Docker and Deployment

### Multi-Stage Build

The Dockerfile uses three stages: dependencies installation, builder (compiles Next.js and Prisma client), and runner (minimal production image). The production image runs as a non-root user (`nextjs:nodejs`, UID 1001).

### Entrypoint Script

On first container start, the entrypoint checks if the database exists at `/app/data/custom.db`. If not, it runs `prisma db push` to initialize the schema, then starts the Next.js application with `bunx next start`.

### Docker Compose

- **Development** (`docker-compose.yml`): Builds the app, mounts local source for hot-reload, exposes ports 3000/3004/3005
- **Production** (`docker-compose.prod.yml`): Adds Caddy reverse proxy with auto-TLS, persistent database volumes, resource limits, and restart policies
- The MT5 bridge service is optional and activated via `docker compose --profile mt5 up`

---

## Configuration and Environment

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `API_SECRET_KEY` | Secret key for trading API authentication |
| `NEXTAUTH_SECRET` | Secret for NextAuth JWT signing |
| `DATABASE_URL` | Prisma SQLite connection string |
| `NEXTAUTH_URL` | Canonical URL for NextAuth |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|--------|
| `FINNHUB_API_KEY` | Finnhub API key for price data | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `GROQ_API_KEY` | Groq API key | - |
| `ZAI_API_KEY` | ZAI SDK API key (default provider) | - |
| `TOGETHER_API_KEY` | Together AI API key | - |
| `TINYFISH_API_KEY` | Tinyfish.ai API key | - |
| `MT5_BRIDGE_URL` | Internal URL for MT5 bridge | `http://localhost:3004` |
| `WS_PRICES_URL` | Internal URL for price service | `http://localhost:3005` |
| `NODE_ENV` | Application environment | `production` |
| `DEFAULT_AI_PROVIDER` | Default AI provider identifier | `zai` |

---

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5.x |
| Runtime | Bun (services) / Node.js (Next.js) |
| Database | SQLite (better-sqlite3) |
| ORM | Prisma |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui (New York) |
| Icons | Lucide React |
| State | Zustand |
| Notifications | Sonner |
| Auth (Web) | NextAuth.js v4 |
| Auth (API) | API Secret Key + timing-safe comparison |
| 2FA | otplib (TOTP) |
| Passwords | bcryptjs |
| Reverse Proxy | Caddy |
| Containerization | Docker + Docker Compose |
| TLS | Let's Encrypt (via Caddy) |
| MT5 Integration | MQL5 Expert Advisor + REST/WebSocket bridge |