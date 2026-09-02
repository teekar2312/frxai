# Changelog

Semua perubahan signifikan pada proyek ini akan didokumentasikan di file ini.

Format berdasarkan [Keep a Changelog](https://keepachangelog.com/), dan proyek ini menggunakan [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [0.2.1] — 2025-01-XX

### Added
- Dokumentasi lengkap: README.md, ARCHITECTURE.md, API.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, DEPLOYMENT.md
- File `.env.example` dengan konfigurasi lengkap dan dokumentasi

---

## [0.2.0] — 2025-01-XX

### Changed (Go-Live Cleanup & Finalization)

Bersihan dan finalisasi seluruh basis kode untuk kesiapan go-live:

- **Dead code removal** — Hapus kode yang tidak terpakai
- **Console.log cleanup** — Hapus debug logging yang tersisa
- **TODO resolution** — Resolve atau document semua remaining TODOs
- **Error handling hardening** — Pastikan semua error path terhandle
- **Production configuration** — Verify `next.config.ts`, `.gitignore`, build process

### Security
- Verified `.gitignore` mengandung `.env*`
- Verified tidak ada kredensial di source code
- Verified Prisma parameterized queries (SQL injection safe)

---

## [0.1.8] — Deep Audit: Dashboard, Notifications, Price Alerts, Reporting

**22 fixes applied:**

### Changed
- Dashboard performance optimizations
- Notification system improvements
- Price alert evaluation accuracy
- Reporting data accuracy fixes

---

## [0.1.7] — Deep Audit: Auto Trailing Stop, Backtesting, Self-Learning ML

**17 improvements applied:**

### Changed
- **Auto Trailing Stop** — Tiered trailing steps, cooldown throttle, break-even floor
- **Backtesting** — EMA Crossover & SMA Crossover engine, equity curve generation
- **Self-Learning ML** — Feedback loop, adaptive weight calibration, strategy performance tracking

---

## [0.1.6] — Deep Audit: Session Manager, Indicator Pool, Trade Execution Engine

**26 improvements applied** (commit `d71a2a4`):

### Session Manager (8 fixes)
1. IDX_SESSIONS_WIB corrected to match canonical mt5-connection times (09:00/09:05/11:30/13:00/16:15 WIB)
2. `getNextPhaseTransition` uses correct WIB boundaries + PRE_CLOSE transition
3. `trackSessionPerformance` uses WIB date via `Intl.DateTimeFormat`
4. `getTodaySessionPerformance` uses WIB date
5. `getSessionRiskBudget` uses WIB date + WIB-aware query boundaries
6. `checkSessionTradingRules` fixed lunch (11:30-13:00) and open (09:05) messages
7. `getSessionQualityScore` corrected afternoon penalties (close at 15:45+ WIB, last 5min urgency)
8. `closeTrade`/`executePartialClose`/`executeTrade` now call `trackSessionPerformance`

### Indicator Pool (7 fixes)
1. Cache key scoped by data identity (symbol:timeframe) — fixes cross-symbol contamination
2. Cache max entries limit (500) with FIFO eviction — prevents memory leak
3. `fetchCandles` now fetches LATEST N candles (was oldest) — critical data fix
4. MACD fast EMA warmup loop added (was stale by slowPeriod-fastPeriod bars)
5. `generateMockCandles` removed misleading SYMBOL_MAP check
6. API route uses module-level pool cache per symbol:timeframe (max 50 pools)
7. Fixed extra leading space in Stochastic %D calculation

### Trade Execution Engine (11 fixes)
1. `processSlTpForAllOpenTrades` filters by symbol — eliminates O(all) DB scans
2. `processTrailingStopsForAllTrades` filters by symbol
3. `checkPartialCloseTriggers` filters by symbol
4. `closeTrade` uses atomic updateMany with status precondition — prevents race condition
5. `emergencyCloseAll` stores pnlPercent in DB
6. `emergencyCloseAll` uses atomic updateMany + skips already-closed trades
7. `executeTrade` reads leverage from riskConfig (fallback 25)
8. `executeTrade` sets entry commission $1/lot (FINEX spec); close adds exit $1/lot
9. `processPriceUpdate` Stage 5: updates currentPrice on open trades per-symbol
10. `syncPositionsWithBroker` calls `updateDailyPerformance` for broker-synced closes
11. `syncPositionsWithBroker` adds comment about stale close price limitation

---

## [0.1.5] — Deep Audit: News API, AI Decision Engine, Sentiment Filter

**17 fixes applied** (commit `b35a5a4`):

### News API
- Provider failover improvements
- Rate limiting accuracy
- Circuit breaker state management
- Deduplication hash stability

### AI Decision Engine
- Technical analysis integration with indicator-pool
- Missing type imports fixed
- Confidence calibration improvements

### Sentiment Filter
- NLP lexicon accuracy
- Regime detection thresholds
- Time decay calculation fix

---

## [0.1.4] — Deep Audit Pass 3: Dashboard, Notifications, Price Alerts, Reporting

**18 improvements applied:**

- Dashboard responsiveness improvements
- Notification delivery reliability
- Price alert trigger accuracy
- Report calculation correctness

---

## [0.1.3] — Deep Audit Pass 2: MT5 Connection, Risk Management, Money Management

**28 deep improvements applied:**

### MT5 Connection
- Heartbeat monitoring stability
- Circuit breaker recovery logic
- Error code mapping completeness

### Risk Management
- Pre-trade validation thoroughness
- Margin monitoring accuracy
- Proactive margin call levels

### Money Management
- Position sizing accuracy
- Kelly Criterion calculation
- Commission-aware sizing ($1/lot)

---

## [0.1.2] — Core Trading Features

### Added
- **Trade Execution Engine** — State machine, SL/TP, trailing stop, partial close
- **Risk Engine** — Multi-layer pre-trade validation, margin monitoring
- **Money Management** — 4 sizing methods, daily performance tracking
- **Session Manager** — IDX trading sessions with WIB timezone

---

## [0.1.1] — AI & Analysis

### Added
- **AI Decision Engine** — 4-factor weighted scoring (technical, news, sentiment, risk)
- **Indicator Pool** — 10 technical indicators with dependency graph
- **News API** — Finnhub & MARKETAUX integration
- **Sentiment Filter** — NLP lexicon 140+ words (EN + ID)
- **7 Trading Strategies** — MA Ribbon, Momentum Scalping, Pivot Point, EMA Crossover, RMI Trend Sync, Linear Regression, EMA/RSI Filter

---

## [0.1.0] — Initial Release

### Added
- Next.js 16 App Router setup with TypeScript
- Prisma 6 + SQLite database (20 models)
- shadcn/ui component library (50+ components)
- Tailwind CSS 4 styling
- MT5 broker connection module
- Real-time trading dashboard
- 20 IDX stock watchlist
- Structured logging system
- Audit trail
- Backtesting framework

---

[Unreleased]: https://github.com/teekar2312/frxai/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/teekar2312/frxai/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/teekar2312/frxai/compare/v0.1.8...v0.2.0
[0.1.8]: https://github.com/teekar2312/frxai/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/teekar2312/frxai/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/teekar2312/frxai/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/teekar2312/frxai/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/teekar2312/frxai/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/teekar2312/frxai/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/teekar2312/frxai/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/teekar2312/frxai/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/teekar2312/frxai/releases/tag/v0.1.0