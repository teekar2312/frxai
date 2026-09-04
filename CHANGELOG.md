# Changelog

Semua perubahan signifikan pada proyek ini akan didokumentasikan di file ini.

Format berdasarkan [Keep a Changelog](https://keepachangelog.com/), dan proyek ini menggunakan [Semantic Versioning](https://semver.org/).

---

## [2.0.2] — RiskManagement Crash Fix & Rich Halt Status

### Fixed
- **`RiskManagement` crash** — `Cannot read properties of undefined (reading 'toFixed')` di
  `sessionRiskUsedPct.toFixed(0)`: komponen merender 7 field yang **tidak pernah dikembalikan**
  API `/api/money-management/halt-status` (`sessionRiskUsedPct`, `sessionPnl`, `sessionPnlLimit`,
  `consecutiveLosses`, `maxConsecutiveLosses`, `equityCurveStatus`, `reasons`). Diperbaiki dari dua sisi:
  - **API diperkaya (additive, backward-compatible)**: `PreTradeHaltStatus` kini menyertakan seluruh
    detail yang selama ini dihitung sub-check lalu dibuang — `consecutiveLosses`,
    `maxConsecutiveLosses`, `cooldownRemainingMinutes`, `equityCurveStatus` (NORMAL/BELOW_MA/RECOVERING),
    `sessionPnl`, `sessionPnlLimit`, `sessionLosses` (baru di `SessionRiskResult`), `sessionRiskUsedPct`
    (loss vs limit, capped 100%), `sessionTrades`, `remainingRiskBudget`, dan `reasons` terstruktur
    (`{type, message, active}` — satu entri per check, selalu ada). Default aman saat sub-check error.
  - **UI defensif**: payload dinormalisasi saat fetch (semua field dijamin ada — respons lama/salah
    bentuk menurunkan tampilan, bukan crash render), `formatCurrency` guard NaN/undefined,
    mapping enum equity curve → label TRADING/HALTED_DRAWDOWN/RECOVERING, guard `Array.isArray`
    untuk reasons, pembagi Progress `Math.max(..., 1)`.

### Verified
- `GET /api/money-management/halt-status` mengembalikan data riil (Equity 13.910 vs MA 11.183,
  limit $100, 0% used); tab Risk & Money render sempurna tanpa console error; sweep 14 tab = 0 error;
  401/401 unit test pass; lint 0 error.

---

## [2.0.1] — Type Safety, Recovery Hints & Code Hygiene

### Critical
- **Zero `any` di seluruh `src/`** (sebelumnya 16): 7× `as any` + 9× `: any` dieliminasi dengan tipe nyata —
  - `src/app/api/ai/config` + `auto-trading` PUT/POST: loop allowlist manual diganti **Zod strict schema** (validasi tipe + range + 400 terstruktur per field, tidak lagi silence-ignore / error 500 dari DB)
  - `auto-trading-loop` fallback error: `{} as any` × 4 → factory `default*Factors()` yang diekspor dari `ai-decision-engine` (+ `llmEnhancement: null` yang sebelumnya hilang)
  - `trade-execution-engine`: `trade?: any`/`closedTrade?: any`/`pendingOrder: any` dll → `TradeRecord` / `PendingOrderRecord` (`Prisma.*GetPayload`, diekspor untuk reuse)
  - `AutoTradingDashboard`: `setMode(v as any)` → narrowing union; `currentDecisions: any[]` → interface `AutoTradingDecisionPreview`
- **`console.log` production di cleanup logger**: ringkasan rotasi log diganti `logger.info('SYSTEM', ...)` dengan metadata hitungan — event rotasi kini terlihat & dapat dicari di UI System Logs (sebelumnya hanya ke stdout). Sisa `console.*` di `src/` kini seluruhnya justifiable: mirror console logger (fungsinya), fallback saat logger/DB gagal (tidak dapat dilog ke dirinya sendiri), output bootstrap env-validation (sebelum logger ada), dan ErrorBoundary React (client-side standar).

### High — Error Handling dengan Recovery Action
- **`src/lib/api-errors.ts` (baru)**: klasifikasi error terstandar → `{ error, code, recovery, retryable, retryAfterMs?, route? }` —
  ApiError / RetryExhaustedError (502 BRIDGE_UNREACHABLE|BRIDGE_TIMEOUT) / CircuitBreakerOpenError (503 + `Retry-After` dari `nextRetryAt`) / ZodError (400 + detail per field) / Prisma P2025→404, P2002→409, P2021/P1003→DATABASE_ERROR / status-tagged 401/404/409/429/5xx / deteksi market-closed (409 MARKET_CLOSED) / fallback 500 dengan hint `/api/health`.
- **13 route kritis di-wire** (`trades/execute`, `mt5/connect`, `execution/*` ×6, `backtest`, `ai/decide`, `ai/enhanced`, `auto-trading`, `ai/config`): catch block kini mengembalikan recovery hint yang actionable, bukan 500 polos.
- Response backward-compatible (field `error` tetap string); builder murni (`classifyApiError`/`buildApiErrorResponse`) mengikuti pola testable `rate-limit.ts`.

### Type System
- `LogCategory` union diperluas dengan kategori yang benar-benar digunakan (`AUTO_TRADING`, `AI_ENHANCED`, `LLM_BRIDGE`, `TRADE_MODIFY`, `POSITION_SYNC`) — menghilangkan 34 error `tsc` laten (string literal valid di DB, tidak pernah terdaftar di union).

### Tests
- `tests/api-errors.test.ts`: 34 test (klasifikasi semua domain, header Retry-After/X-Request-Id, body roundtrip, heuristic market-closed) → **total 401 test / 14 file, 100% pass**.

### Verified
- Browser E2E: 14 tab render, 0 console error; Auto Trading config (dropdown mode) fungsional; Backtest run end-to-end via UI (POST 201, status COMPLETED); error format baru diverifikasi via curl (JSON invalid → 500 + code INTERNAL_ERROR + recovery + route).

### Fixed
- **`StrategyMonitor` crash** — `strategies.filter is not a function`: komponen memasukkan `json.data` (object) ke state padahal endpoint `/api/strategies` mengembalikan array di `data.strategies`. Kini: pembacaan `data.strategies` + guard `Array.isArray` (respons salah bentuk → pertahankan data lama, tanpa crash) + mapping field yang benar (`enabled`→`status`, `currentSignal` `NEUTRAL`→`HOLD`, `lastUpdated`→waktu lokal, `activeSymbol` dari sinyal per-simbol). Sekalian diperbaiki: polling 10s yang berhenti permanen setelah ganti tab (handler `visibilitychange` lama menghapus interval tanpa restart) → kini reaktiv via state `visible`.

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
---

## [2.0.0] — Hardening: Reliability, Testing & Observability

### Critical (Audit Prioritas)
- **Unit tests**: 13 file / 367 test / 5.300+ assertions (bun test), 100% pass. Coverage modul baru 81–100%.
- **Runtime env validation** (`src/lib/env-validation.ts`): Zod schema 60+ variabel, fail-fast production/strict, warning+safe-default development.
- **Bridge retry** (`src/lib/retry.ts` + integrasi `mt5-connection.ts`): exponential backoff + full jitter, classifier transient (ECONNRESET/timeout/408/425/429/5xx/MT5 retryable codes), `RetryExhaustedError`, metrics latency bridge.

### High
- **Rate limiting global** (`src/middleware.ts` + `src/lib/rate-limit.ts`): sliding window per IP × tier (READ 100 / WRITE 20 / AI 10 / DRAFT 5 per window default), 429 + `Retry-After` + `X-RateLimit-*`, `/api/health` & `/api/metrics` exempt.
- **Log rotation env-configurable**: `LOG_RETENTION_DAYS` (30), `MT5_LOG_RETENTION_DAYS` (7), `NEWS_LOG_RETENTION_DAYS` (14), `LOG_CLEANUP_INTERVAL_HOURS` (6), `LOG_DEDUP_WINDOW_MS` (60s) + cleanup NotificationLog.
- **Circuit breaker persisten**: auto-persist tiap transisi (kolom Mt5ConnectionState + snapshot SystemConfig), restore saat boot dengan konversi OPEN kadaluarsa → HALF_OPEN, notifikasi operator saat restore non-CLOSED.

### Medium
- **Configuration management** (`src/lib/app-config.ts`): hierarki 4-layer default→env→DB→runtime, 40 definisi tervalidasi, hot-reload 30s, listener, `/api/config` + AuditTrail.
- **Notification hooks**: `src/lib/notifier.ts` Telegram (HTML) + Discord (embed) dengan severity/event filter, outbound rate cap, retry transient, auto-disable 10 error beruntun; hook ke tradeEventBus (OPEN/CLOSED/SL/TP/MARGIN_CALL/EMERGENCY) & RiskEvent HIGH/CRITICAL; UI konfigurasi + Send Test + log.
- **Backtest engine v2** (`src/lib/backtest-engine.ts`): 6 strategi nyata (SMA/EMA crossover, RSI mean-reversion, MACD momentum, Bollinger & Donchian breakout — band/channel sebelumnya, tanpa self-inclusive), ATR SL/TP intrabar (SL prioritas), komisi+slippage, metrics lengkap (Sharpe/Sortino/Calmar/expectancy/PF/gross/streaks/exposure/DD abs), per-trade ledger (BacktestTrade), synthetic candles deterministik fallback (berlabel), tanpa mock.
- **Monitoring & observability**: `/api/health` (liveness/readiness + HealthCheckLog retensi 24j), `/api/metrics` (JSON + Prometheus text + snapshot DB), `src/lib/metrics.ts` counter/gauge/histogram p50/p95/p99, X-Request-Id correlation.

### Bug fixes (ditemukan oleh test suite)
- `env-validation.ts`: duplikat export `EnvSchema` (ESM SyntaxError di bun) — dihapus.
- `app-config.ts`: `setConfigValue` melempar `ReferenceError: newValue is not defined` pada path sukses — diperbaiki.
- `rate-limit.ts`: prune menghapus bucket sebelum hit pertama → budget efektif +1 — guard `createdAt`.
- `backtest-engine.ts` + `indicator-pool.ts`: RSI flat-series mengembalikan 100 → 50 (neutral).
- `backtest-engine.ts`: `Ema.ready` true saat warm-up — kini konsisten dengan `update()`.
- `indicator-pool.ts`: sinyal `ma-ribbon` terbalik (bullish stacking dikira bearish) — BUY/SELL dikoreksi.
- `mt5-connection.ts` `getTradingPhase` + `session-manager.ts`: weekend (Sabtu/Minggu) kini CLOSED, cek weekend didahulukan di `checkSessionTradingRules`.
- Backtest breakout: band/channel membandingkan bar saat ini terhadap band sebelumnya.

### Database
- Model baru: `BacktestTrade`, `NotificationLog`, `NotificationConfig`, `HealthCheckLog`, `MetricsSnapshot`; kolom v2 di `BacktestResult`.
