<div align="right">
  <img src="https://img.shields.io/badge/license-Private-9333ea" alt="License: Private" />
</div>

FINEX Indonesia (FRXAI) — AI-Powered Forex Trading Dashboard, v2.3.0

---

- [overview](#overview)
- [tech-stack](#tech-stack)
- [key-features](#key-features)
- [architecture](#architecture)
- [database-models](#database-models)
- [api-routes](#api-routes)
- [forex-pairs](#forex-pairs)
- [quick-start](#quick-start)
- [environment-variables](#environment-variables)
- [docker-deployment](#docker-deployment)
- [ai-providers](#ai-providers)
- [trading-strategies](#trading-strategies)
- [technical-indicators](#technical-indicators)
- [regulatory-compliance](#regulatory-compliance)
- [license](#license)

---

## Overview

FINEX Indonesia (FRXAI) is a full-stack, AI-powered forex trading dashboard designed specifically for the Indonesian market. The platform combines real-time price streaming, multi-provider AI analysis, automated trade execution, and backtesting into a single self-hosted application. It is built with BAPPEBTI (Badan Pengawas Perdagangan Berjangka Komoditi) regulatory compliance at its core, enforcing leverage caps, risk disclosures, and fund segregation notices throughout the interface.

## Tech Stack

| Layer              | Technology                                                                 |
|--------------------|-----------------------------------------------------------------------------|
| Framework          | Next.js 16 (App Router, TypeScript)                                        |
| Styling            | Tailwind CSS 4 + shadcn/ui (New York style)                                |
| Database           | Prisma ORM + SQLite (better-sqlite3)                                       |
| Client State       | Zustand                                                                     |
| Server State       | TanStack Query                                                              |
| Authentication     | NextAuth.js v4 (credentials provider + 2FA/TOTP via otplib)                |
| Charts             | Recharts + TradingView Lightweight Charts                                   |
| Animation          | Framer Motion                                                               |
| Runtime            | Bun                                                                         |
| Email              | Resend                                                                      |
| MT5 Bridge         | Dedicated HTTP polling service (port 3004) with MetaTrader EA              |
| Price Service      | WebSocket mini-service (port 3005) or Finnhub API polling fallback         |

## Key Features

**Real-Time Market Data**

- Live forex price streaming via WebSocket (ws-prices service on port 3005) with automatic fallback to Finnhub REST API polling.

**AI-Powered Analysis**

- Six interchangeable AI providers: ZAI, Groq, OpenAI, Together AI, Tinyfish.ai, and Lokal AI/Ollama for self-hosted inference.
- Multi-timeframe (MTF) analysis that combines signals across multiple chart periods.
- News-price correlation analysis linking market events to price movements.

**Technical Analysis**

- 30+ technical indicators including SMA, EMA, RSI, MACD, Bollinger Bands, Ichimoku Cloud, Supertrend, ADX, ATR, Stochastic, Williams %R, and more.
- 7 built-in trading strategies: MA Ribbon, Momentum Scalping, Pivot Point, EMA Crossover, RMI Trend Sync, Linear Regression, and EMA RSI Filter.

**Trading Execution**

- Manual and automated trade execution with stop-loss (SL), take-profit (TP), and trailing stop support.
- Pending orders: limit, stop, buy limit, buy stop, sell limit, sell stop — all with pre-trade safety checks.
- Margin call and stop-out monitoring with configurable thresholds.
- Server-side auto-trading engine running on a 30-second scheduler.
- Full MT5 MetaTrader integration via bridge service (port 3004) using an EA + HTTP polling architecture.

**Risk and Analytics**

- Backtesting engine producing Sharpe ratio, profit factor, maximum drawdown, and equity curves.
- Trade analytics dashboard with win rate, PnL tracking, and cumulative equity visualization.
- Price alerts with email notifications through Resend.
- Economic calendar with automatic high-impact event detection.

**Platform Features**

- Dark trading terminal UI optimized for extended screen time, fully responsive on mobile.
- PWA manifest for home-screen installation on mobile devices.
- Internationalization (i18n) with Indonesian and English locales (225+ translation keys).
- Currency display in IDR at a configurable base rate (default 15,850).
- Signal sharing and community discussion with per-signal comment threads.
- Admin panel for user management (activate/deactivate accounts, role changes).
- Deposit and withdrawal tracking with full transaction history.

## Architecture

The application follows a monorepo-style structure with the Next.js app as the central service and auxiliary micro-services for specialized functions:

```
frxai/
+-- prisma/              # Schema, migrations, seed data
+-- public/              # Static assets, PWA manifest
+-- src/
|   +-- app/             # Next.js App Router pages and layouts
|   +-- components/      # React components (shadcn/ui + custom)
|   +-- lib/             # Utilities, helpers, constants
|   +-- stores/          # Zustand client-side stores
|   +-- hooks/           # Custom React hooks
|   +-- services/        # AI providers, MT5 bridge client, price service
|   +-- i18n/            # Translation files (id.json, en.json)
+-- docker-compose.yml          # Development stack
+-- docker-compose.prod.yml     # Production overlay (Caddy reverse proxy)
+-- .env.example                # Environment variable template
```

Supporting services:

| Service          | Port | Purpose                                          |
|------------------|------|--------------------------------------------------|
| Next.js App      | 3000 | Main application server                         |
| MT5 Bridge       | 3004 | MetaTrader 5 integration (EA + HTTP polling)    |
| WebSocket Prices | 3005 | Real-time forex price streaming                  |
| Caddy (prod)     | 80/443 | HTTPS reverse proxy and automatic TLS           |

## Database Models

Prisma ORM manages 16 models in a SQLite database:

| Model              | Description                                    |
|--------------------|------------------------------------------------|
| User               | Account credentials, roles, balance, preferences |
| UserTwoFactor      | TOTP secret, backup codes, verification status  |
| TradingPosition    | Open and closed trades with SL/TP/trailing stop  |
| PendingOrder       | Limit and stop orders awaiting execution        |
| PriceAlert         | User-defined price thresholds with trigger state |
| ActivityLog        | Audit trail of user actions and system events   |
| AiAnalysis         | Cached AI provider responses and market insights |
| BacktestResult     | Strategy backtest outputs and performance metrics |
| NewsItem           | Fetched and correlated news articles            |
| TradingConfig      | User-specific and global trading parameters     |
| Notification       | In-app notification records                     |
| EconomicEvent      | Economic calendar entries and impact levels     |
| WatchlistPair      | User watchlist entries                          |
| SharedSignal       | Community-published trade signals               |
| SignalComment      | Discussion threads on shared signals            |
| Transaction        | Deposit and withdrawal records                  |

## API Routes

The platform exposes 42 API endpoints organized by domain:

**Authentication and Users**

| Endpoint                     | Method | Description                       |
|------------------------------|--------|-----------------------------------|
| /api/auth/[...nextauth]      | POST   | NextAuth credentials sign-in      |
| /api/auth/register           | POST   | New account registration           |
| /api/auth/forgot-password    | POST   | Password reset request             |
| /api/auth/reset-password     | POST   | Password reset confirmation        |
| /api/auth/2fa/setup          | POST   | Generate TOTP secret and QR code   |
| /api/auth/2fa/verify         | POST   | Verify TOTP code during setup      |
| /api/auth/2fa/status         | GET    | Check 2FA enrollment status        |
| /api/auth/2fa/disable        | POST   | Disable two-factor authentication  |
| /api/admin/users             | GET/PUT| Admin user management              |

**Market Data and Analysis**

| Endpoint                     | Method | Description                       |
|------------------------------|--------|-----------------------------------|
| /api/health                  | GET    | Service health check               |
| /api/finnhub                 | GET    | Finnhub market data proxy          |
| /api/news                    | GET    | Forex news feed                    |
| /api/analysis                | GET    | Single-timeframe AI analysis       |
| /api/analysis/mtf            | GET    | Multi-timeframe AI analysis        |
| /api/indicators              | GET    | Technical indicator calculations   |
| /api/market-condition        | GET    | Current market regime assessment   |
| /api/correlation             | GET    | News-price correlation data        |
| /api/economic-calendar       | GET    | Upcoming economic events           |

**Trading**

| Endpoint                     | Method | Description                       |
|------------------------------|--------|-----------------------------------|
| /api/positions               | GET/POST/DELETE | Manage trading positions   |
| /api/pending-orders          | GET/POST/DELETE | Manage pending orders        |
| /api/auto-execute            | POST   | Trigger auto-trading engine cycle  |
| /api/trailing-stop/process   | POST   | Evaluate and adjust trailing stops |
| /api/alerts                  | GET/POST/DELETE | Manage price alerts         |
| /api/risk                    | GET    | Account risk metrics               |
| /api/trade-analytics         | GET    | Historical trade statistics        |
| /api/backtest                | POST   | Run strategy backtest              |
| /api/watchlist               | GET/POST/DELETE | Manage watchlist pairs     |

**Platform**

| Endpoint                     | Method | Description                       |
|------------------------------|--------|-----------------------------------|
| /api/config                  | GET/PUT| Trading configuration               |
| /api/logs                    | GET    | Activity and system logs            |
| /api/transactions            | GET/POST | Deposit and withdrawal records    |
| /api/notifications           | GET    | User notifications                 |
| /api/notifications/unread-count | GET | Unread notification count         |
| /api/signals/shared          | GET/POST | Community shared signals         |
| /api/signals/shared/[id]/comments | GET/POST | Signal comments             |
| /api/export                  | GET    | Export trade data                   |
| /api/ai-providers            | GET    | List configured AI providers        |

**MetaTrader 5 Integration**

| Endpoint                     | Method | Description                       |
|------------------------------|--------|-----------------------------------|
| /api/mt5/account             | GET    | MT5 account info                   |
| /api/mt5/connection          | GET    | MT5 bridge connection status       |
| /api/mt5/orders              | GET/POST | MT5 order management            |
| /api/mt5/positions           | GET    | MT5 open positions                 |
| /api/mt5/prices              | GET    | MT5 live prices                    |
| /api/mt5/trailing-stop       | POST   | MT5 trailing stop management       |

## Forex Pairs

The platform supports four primary pairs optimized for the Indonesian retail trading market:

- **EURUSD** — Euro / US Dollar
- **USDJPY** — US Dollar / Japanese Yen
- **GBPUSD** — British Pound / US Dollar
- **XAUUSD** — Gold / US Dollar

All pairs stream in real time and display prices in both the base currency and converted IDR at the configured exchange rate.

## Quick Start

**Prerequisites:** Bun runtime installed on your system.

```bash
# 1. Clone the repository
git clone https://github.com/your-org/frxai.git
cd frxai

# 2. Create environment file and fill in required secrets
cp .env.example .env
# Edit .env and set at minimum:
#   NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
#   API_SECRET_KEY=<generate with: openssl rand -hex 32>

# 3. Install dependencies
bun install

# 4. Initialize the database
bun run db:push

# 5. Start the development server
bun run dev

# 6. Open the application
# Navigate to http://localhost:3000
# Register a new account and begin trading
```

The first registered user receives the `user` role by default. To grant admin privileges, update the role via the `/api/admin/users` endpoint or directly in the database.

## Environment Variables

| Variable              | Required | Default  | Description                                |
|-----------------------|----------|----------|--------------------------------------------|
| DATABASE_URL          | Yes      | —        | SQLite connection string                   |
| NEXTAUTH_SECRET       | Yes      | —        | Secret for NextAuth JWT and session tokens |
| API_SECRET_KEY        | Prod     | —        | Bearer token for securing API endpoints    |
| FINNHUB_API_KEY       | No       | —        | Finnhub API key for market data            |
| MARKETAUX_API_KEY     | No       | —        | Marketaux API key for news fetching        |
| GROQ_API_KEY          | No       | —        | Groq API key for AI analysis               |
| OPENAI_API_KEY        | No       | —        | OpenAI API key for AI analysis             |
| TOGETHER_API_KEY      | No       | —        | Together AI API key                        |
| TINYFISH_API_KEY      | No       | —        | Tinyfish.ai API key                       |
| LOKAL_AI_ENDPOINT     | No       | —        | Lokal AI / Ollama base URL                 |
| RESEND_API_KEY        | No       | —        | Resend API key for email notifications     |
| IDR_RATE              | No       | 15850    | USD to IDR conversion rate                 |
| ALLOW_REGISTRATION    | No       | false    | Set to true to enable public registration  |
| MT5_BRIDGE_URL        | No       | —        | URL of the MT5 bridge service              |
| WS_PRICES_URL         | No       | —        | WebSocket price service URL                |

## Docker Deployment

**Development**

```bash
docker compose up -d --build
```

**Production** (includes Caddy reverse proxy with automatic HTTPS)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The production overlay adds Caddy as a reverse proxy with automatic TLS and optimized Next.js build settings.

---

## AI Providers

The platform integrates with six AI providers, selectable per analysis request through the `/api/ai-providers` configuration:

| Provider       | Type            | Notes                                           |
|----------------|-----------------|--------------------------------------------------|
| ZAI            | Cloud           | Primary provider, optimized for financial data  |
| Groq           | Cloud           | Low-latency inference                           |
| OpenAI         | Cloud           | GPT-series models                               |
| Together AI    | Cloud           | Open-source model hosting                       |
| Tinyfish.ai    | Cloud           | Specialized analysis provider                   |
| Lokal AI       | Self-hosted     | Runs via Ollama for full data privacy           |

Multiple providers can be configured simultaneously, and the system will fail over gracefully if the selected provider is unavailable.

## Trading Strategies

| Strategy            | Approach                        | Best For                    |
|---------------------|---------------------------------|-----------------------------|
| MA Ribbon           | Moving average ribbon crossover | Trend identification         |
| Momentum Scalping   | High-frequency momentum shifts | Short-term scalp trades     |
| Pivot Point         | Daily pivot support/resistance  | Intraday range trading      |
| EMA Crossover       | Fast/slow EMA signal crossing  | Swing trading               |
| RMI Trend Sync      | Relative Momentum Index sync    | Trend continuation          |
| Linear Regression   | Statistical price projection    | Mean reversion trades       |
| EMA RSI Filter      | EMA direction with RSI filter   | Filtered trend entries      |

All strategies are backtestable through the `/api/backtest` endpoint and can be deployed to the auto-trading engine for continuous execution.

## Technical Indicators

Over 30 indicators are available, computed server-side and returned via `/api/indicators`:

Moving Averages: SMA, EMA, WMA, DEMA, TEMA, KAMA, Hull MA, VWMA

Oscillators: RSI, MACD, Stochastic, Williams %R, CCI, Momentum, ROC

Volatility: Bollinger Bands, ATR, Keltner Channels, Donchian Channels, Standard Deviation

Trend: ADX, Ichimoku Cloud, Supertrend, Parabolic SAR, Vortex Indicator, TRIX

Volume: OBV, VWAP, MFI

Other: Pivot Points, Fibonacci Retracement, Linear Regression, RMI

## Regulatory Compliance

FINEX Indonesia is designed with BAPPEBTI (Badan Pengawas Perdagangan Berjangka Komoditi) compliance as a foundational requirement:

- **Maximum leverage capped at 1:100** in accordance with BAPPEBTI regulations for retail forex trading.
- **Risk disclosure notices** are displayed prominently during registration, trade execution, and throughout the trading interface.
- **Fund segregation notice** informs users that traded funds are maintained separately from operational funds.
- All compliance messaging is available in both Indonesian (Bahasa Indonesia) and English through the i18n system.

---

## License

Private — All rights reserved. This software and its source code are proprietary. Redistribution, reverse engineering, or commercial use without explicit written permission from the copyright holder is strictly prohibited.
