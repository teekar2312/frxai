# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet.

## [2.3.0] - 2025-08-21

Deep audit release resolving 13 disconnected process flows and preparing the
application for production go-live.

### Critical
- Balance sync on every position close (SL/TP, manual, stop-out) via
  `applyPnlToBalance()` to prevent balance desynchronization
- 2FA/TOTP enforcement during login when the feature is enabled on the account
- Email notifications sent on SL/TP close, stop-out events, auto-execute
  triggers, and pending order execution
- Stop-out completion flow now records `closeReason`, dispatches real-time
  notifications, sends email, and synchronizes balance

### High
- Pending order safety checks added: `maxPositions` enforcement,
  `avoidNewsTrading` compliance, and spread-adjusted pricing on execution
- Server-side `avoidNewsTrading` enforcement applied across position opening,
  auto-execute, and pending order creation
- `closeReason` is now stored on closed positions and displayed to users via
  real-time toasts

### Medium
- Notification endpoint authentication fixed by removing `validateAuth` from
  GET notification routes, allowing push delivery without session conflicts
- News-AI prompt pair-matching corrected to include untagged news items that
  were previously filtered out silently

### Low
- SL/TP execution now uses bid/ask prices instead of mid price for accurate
  fill simulation
- 2FA verification state stored in JWT token to persist across session refreshes
- Stop-out events now set `closeReason=stop_out` on the closed position record

### Production
- Added `docker-entrypoint.sh` for automatic database initialization on
  container startup
- Created `mini-services/mt5-bridge/Dockerfile` which was previously missing
- Fixed `ws-prices` Dockerfile by removing `--hot` flag for production builds
- Fixed `.dockerignore` to unblock `bun.lock` from exclusion, enabling proper
  dependency installation in containers
- Renamed project in `package.json` to `finex-indonesia` version 2.3.0
- Added `ALLOW_REGISTRATION` environment variable to
  `docker-compose.prod.yml`
- Added auth rate-limit bucket (10 requests/minute) in `rate-limit.ts`
- Regenerated Prisma migration to match the current schema state

### Files Changed
- Added: `docker-entrypoint.sh`, `mini-services/mt5-bridge/Dockerfile`
- Modified: `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`,
  `package.json`, `.env.example`, `src/lib/rate-limit.ts`, `prisma/migrations`

## [2.2.0] - 2025-08-20

Gap analysis release addressing 18 identified feature gaps with major
integrations and expanded platform capabilities.

### Added
- MT5 MetaTrader integration with dedicated bridge service, Expert Advisor,
  API routes, and management UI
- MT5 connection panel displaying real-time bridge status and connectivity
- MT5 account info retrieval, order management, position tracking, live prices,
  and trailing stop control
- Multi-provider AI architecture supporting six providers with automatic
  failover
- AI provider selector in Settings allowing users to choose their preferred
  analysis provider
- Multi-timeframe (MTF) analysis for comprehensive market assessment
- Economic calendar with detailed event information and impact levels
- News-price correlation integrated into AI market analysis
- Signal sharing with comment threads for collaborative trading
- Watchlist management for tracking preferred instruments
- Admin user management with full CRUD operations
- i18n expansion to 110+ translation keys supporting Indonesian and English
  locales
- IDR currency display option for localized trading experience
- Deposit and withdrawal transaction tracking with history
- Password reset flow with forgot-password and reset-password pages
- Legal pages (terms of service, privacy policy, risk disclosure, about) written
  in Bahasa Indonesia

## [2.1.0] - 2025-08-19

Post-audit improvements release with 10 enhancements focused on automation,
alerts, and analytics.

### Added
- Trailing stop functionality supporting both manual and automatic modes
- Auto-trading engine with server-side scheduler for strategy execution
- Pending orders including limit, stop, buy limit, buy stop, sell limit, and
  sell stop types
- Price alerts with email notification delivery
- Trade analytics panel featuring equity curve visualization and key
  performance statistics
- Export to CSV for trade history and analytics data
- Activity log panel for auditing account actions and system events
- Enhanced backtesting engine with expanded performance metrics

### Changed
- Various UI/UX improvements across trading panels and dashboard widgets

## [2.0.0] - 2025-08-18

Major feature release introducing 17 new capabilities including AI analysis,
technical indicators, live trading, and real-time market data.

### Added
- AI-powered market analysis powered by ZAI SDK
- 30+ technical indicators covering trend, momentum, volatility, and volume
- 7 trading strategies with configurable parameters
- Live trading with stop-loss and take-profit management
- Risk management panel for position sizing and exposure control
- Candlestick chart integration using Lightweight Charts library
- Real-time price streaming in simulation mode
- News integration via MARKETAUX API
- Economic calendar with scheduled event tracking
- Backtesting engine for strategy evaluation against historical data
- Dashboard with portfolio overview, balance summary, and open positions
- Responsive mobile design adapting all panels to smaller viewports
- Dark trading terminal UI optimized for extended screen time
- 2FA/TOTP authentication for enhanced account security
- Progressive Web App (PWA) manifest for installable experience

## [1.0.0] - 2025-08-15

Initial release of FINEX Indonesia.

### Added
- Next.js 16 application using App Router with TypeScript
- Tailwind CSS 4 with shadcn/ui component library
- Prisma ORM with SQLite for persistent storage
- NextAuth.js authentication with email and credentials providers
- Basic dashboard layout with navigation and sidebar
- Login and registration pages

[Unreleased]: https://github.com/finex-indonesia/finex-indonesia/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/finex-indonesia/finex-indonesia/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/finex-indonesia/finex-indonesia/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/finex-indonesia/finex-indonesia/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/finex-indonesia/finex-indonesia/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/finex-indonesia/finex-indonesia/releases/tag/v1.0.0
