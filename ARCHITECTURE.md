# Architecture

> Desain arsitektur sistem FINEX AI Trader

---

## Daftar Isi

- [Overview Arsitektur](#overview-arsitektur)
- [High-Level Diagram](#high-level-diagram)
- [Core Modules](#core-modules)
- [Data Flow](#data-flow)
- [Database Schema](#database-schema)
- [API Architecture](#api-architecture)
- [State Management](#state-management)
- [Error Handling Strategy](#error-handling-strategy)
- [Caching Strategy](#caching-strategy)
- [Concurrency & Race Conditions](#concurrency--race-conditions)
- [Timezone Handling](#timezone-handling)
- [7 Trading Strategies](#-7-trading-strategies)

---

## Overview Arsitektur

FINEX AI Trader menggunakan arsitektur **monolithic Next.js App Router** dengan modular business logic. Semua komputasi berjalan di server-side (API routes) sementara frontend hanya bertanggung jawab untuk rendering dan interaksi.

### Prinsip Desain

| # | Prinsip | Deskripsi |
|---|---------|-----------|
| 1 | **Server-First** | Semua business logic, database access, dan komputasi berjalan di API routes (server-side). `z-ai-web-dev-sdk` hanya boleh digunakan di backend. |
| 2 | **Atomic Operations** | Semua trade state changes menggunakan `updateMany` dengan precondition check untuk mencegah race conditions. |
| 3 | **Single Source of Truth** | Database SQLite/Prisma adalah satu-satunya source of truth untuk semua state. |
| 4 | **Event-Driven Logging** | Setiap operasi penting mencatat audit trail dan structured logs. |
| 5 | **Graceful Degradation** | Sistem tetap berfungsi (dengan peringatan) jika MT5 tidak terhubung atau API external gagal. |

---

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client)                             │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              Next.js Frontend (React SPA)                       │ │
│  │  Dashboard │ Trading │ AI/Sentiment │ Risk │ News │ Sessions   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              │ fetch()                              │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│                    NEXT.JS APP ROUTER (Port 3000)                   │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │                  38 API ROUTE FILES (58 handlers)             │  │
│  └───────────────────────────┼───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │              CORE BUSINESS LOGIC (10 modules, 27K LOC)        │  │
│  │                                                              │  │
│  │  MT5 Connection ←──→ Trade Execution Engine                   │  │
│  │       ↕                    ↕                                   │  │
│  │  Session Manager    Money Management                          │  │
│  │       ↕                    ↕                                   │  │
│  │  Indicator Pool ←→ AI Decision Engine                         │  │
│  │       ↕              ↕          ↕                              │  │
│  │  Candle Data    News API   Sentiment Filter                   │  │
│  │                              ↕                                  │  │
│  │                       Risk Engine                              │  │
│  │                       Trading Logger                           │  │
│  └───────────────────────────┼───────────────────────────────────┘  │
│                              │                                      │
│  ┌──────────────┐ ┌──────────┴────────┐ ┌───────────────────────┐   │
│  │ SQLite (Prisma)│ │ External APIs    │ │ MT5 Python Bridge    │   │
│  │ 20 models      │ │ Finnhub/Marketaux │ │ (MetaTrader 5)       │   │
│  └────────────────┘ └───────────────────┘ └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### 1. MT5 Connection Manager (`src/lib/mt5-connection.ts`)

**2,000+ baris** — Integrasi dengan MetaTrader 5 via Python bridge.

| Fitur | Deskripsi |
|-------|-----------|
| Async Mutex | Serialisasi semua MT5 API calls (thread-safety) |
| Heartbeat | Monitoring koneksi dengan interval configurable |
| Auto-Reconnect | Exponential backoff: 1s → 2s → 4s → 8s → 16s → max 30s |
| Circuit Breaker | 3 state: CLOSED (normal), OPEN (tripped), HALF_OPEN (probing) |
| Error Mapping | MT5 codes 10004-10036 → severity, category, remediation |
| Symbol Map | 20 saham IDX dengan sector classification |
| IDX Hours | WIB timezone awareness (09:00-17:00 WIB) |
| Silent Failure Detection | `validateReturn()` untuk mendeteksi kegagalan tanpa error |

**Key Exports:**

```typescript
connectToMt5(login, password, server): Promise<ConnectResult>
disconnectFromMt5(): Promise<void>
executeOrderWithRetry(params): Promise<OrderExecutionResult>
getTradingPhase(): TradingPhase
isMarketOpen(): boolean
validateSymbol(symbol): boolean
SYMBOL_MAP: Record<string, SymbolMappingEntry>
```

### 2. Trade Execution Engine (`src/lib/trade-execution-engine.ts`)

**2,200+ baris** — Manajemen siklus hidup trade.

| Komponen | Deskripsi |
|----------|-----------|
| Trade State Machine | Valid transitions: PENDING→OPEN→CLOSED, OPEN→PARTIAL_FILLED→CLOSED |
| SL/TP Trigger Engine | Evaluasi otomatis saat price update |
| Trailing Stop Engine | Tiered trailing steps, cooldown throttle, break-even floor |
| Partial Close Engine | Scaled exit pada level TP yang ditentukan |
| Price Update Pipeline | Orchestrator: trailing → SL/TP → partial close → alerts |
| Emergency Close All | Atomic close semua posisi (margin call / connection loss) |
| Position Sync | Reconcile broker ↔ local DB |

**Atomic Update Pattern** (kritis untuk mencegah race conditions):

```typescript
const count = await db.trade.updateMany({
  where: { id: tradeId, status: { in: ['OPEN', 'PARTIAL_FILLED'] } },
  data: { status: 'CLOSED', closePrice, pnl, pnlPercent, ... }
})
if (count === 0) throw new Error('Trade already closed or not found')
```

### 3. Risk Engine (`src/lib/risk-engine.ts`)

**2,500+ baris** — Validasi dan monitoring risiko multi-layer.

| Layer | Deskripsi |
|-------|-----------|
| Pre-Trade Check | Validasi sebelum trade dibuka (position limits, margin, daily loss) |
| Margin Monitoring | Real-time margin level tracking |
| Proactive MC | Warning zone 70%, reduce 50% at 60% |
| Stop Out Detection | Auto close posisi saat equity < stop out level |
| Daily/Weekly/Monthly Limits | Persentase loss limit dari equity |
| Gap Risk | Assessment risiko overnight gap |
| Volatility Regime | HIGH_VOLATILITY → reduce 50%, LOW_VOLATILITY → reduce 20% |
| Consecutive Loss Halt | Auto-halt setelah N kerugian beruntun + cooldown |
| Equity Curve Monitor | Halt saat equity < MA(equity, 20) |
| Portfolio Risk Cap | Batas total risiko portfolio |
| Concentration Limit | Batas eksposur per sektor dan per saham |
| Reserve Capital | Enforce 20% reserve capital |

### 4. Money Management (`src/lib/money-management.ts`)

**1,800+ baris** — Position sizing dan performance tracking.

| Metode Sizing | Deskripsi |
|---------------|-----------|
| Fixed Fractional | Default — risk % dari equity per trade |
| Kelly Criterion | Half-Kelly (konservatif) berdasarkan win rate historis |
| Fixed Dollar | Risk dollar amount tetap per trade |
| Anti-Martingale | Naikkan size setelah win, turunkan setelah loss |

**Fitur Tambahan:** Commission-aware sizing ($1/lot FINEX), reserve capital enforcement, performance-based dynamic scaling, daily performance tracking (WIB date), drawdown recovery modeling, risk-of-ruin estimation.

### 5. AI Decision Engine (`src/lib/ai-decision-engine.ts`)

**2,800+ baris** — Sintesis 4 faktor keputusan trading.

```
┌──────────────────────────────────────────────┐
│           AI DECISION ENGINE                 │
│                                              │
│  Technical Analysis (50%) ← Indicator Pool   │
│  News Impact (25%)        ← News API         │
│  Sentiment (25%)          ← Sentiment Filter │
│  Risk Context             ← Risk Engine      │
│                                              │
│  → Weighted Score → Confidence → Decision    │
│  → BUY | SELL | HOLD | SKIP | REDUCE         │
└──────────────────────────────────────────────┘
```

| Komponen | Deskripsi |
|----------|-----------|
| Technical Synthesizer | Analisis 10 indikator teknikal |
| News Impact Analysis | Berita dari Finnhub/Marketaux |
| Sentiment Integration | Score -100 to +100 dengan regime |
| Risk Context Analyzer | Daily loss, drawdown, consecutive losses |
| Batch Decision Processing | Keputusan multi-saham sekaligus |
| Accuracy Tracker | Kalibrasi confidence vs outcome aktual |
| Override System | Manual override dengan alasan |
| Self-Learning | Adaptive weights berdasarkan feedback loop |

### 6. Indicator Pool (`src/lib/indicator-pool.ts`)

**2,000+ baris** — 10 indikator teknikal dengan dependency graph.

| Indikator | Tipe | Parameter Default |
|-----------|------|-------------------|
| SMA | Trend | Period: 20 |
| EMA | Trend | Period: 20 |
| RSI | Momentum | Period: 14 |
| MACD | Trend | Fast: 12, Slow: 26, Signal: 9 |
| ATR | Volatility | Period: 14 |
| Bollinger Bands | Volatility | Period: 20, StdDev: 2 |
| Stochastic | Momentum | %K: 14, %D: 3 |
| ADX | Trend | Period: 14 |
| VWAP | Volume | Intraday |
| Pivot Points | Support/Resistance | Classic |

**Fitur:** Dependency graph, FIFO cache eviction (max 500 entries), scope-based cache keys, mock candle fallback.

### 7. Session Manager (`src/lib/session-manager.ts`)

**800+ baris** — Manajemen sesi trading IDX dan Forex.

| Sesi IDX | Waktu (WIB) |
|----------|-------------|
| Pre-Market | 09:00 - 09:05 |
| Session 1 | 09:05 - 11:30 |
| Lunch Break | 11:30 - 13:00 |
| Session 2 | 13:00 - 16:15 |
| Post-Close | 16:15 - 17:00 |

**Fitur:** Phase transitions, session performance tracking, quality scoring (penalty sore hari), risk budget per session, forex session overlaps.

### 8. News API (`src/lib/news-api.ts`)

**1,600+ baris** — Integrasi berita multi-provider.

| Provider | Rate Limit | Fitur |
|----------|------------|-------|
| Finnhub | 60 calls/min | US & global market news |
| MARKETAUX | 100 calls/day | Indonesian market coverage |

**Fitur:** LRU cache, rate limiting, circuit breaker, deduplication, breaking news detection, multi-provider failover.

### 9. Sentiment Filter (`src/lib/sentiment-filter.ts`)

**1,300+ baris** — NLP sentiment analysis.

| Fitur | Deskripsi |
|-------|-----------|
| Lexicon | 140+ kata (EN + ID) dengan weight |
| Regime Detection | 5 state: BULLISH, EXTREME_GREED, NEUTRAL, EXTREME_FEAR, BEARISH |
| Trade Filtering | Block trades pada extreme sentiment |
| Size Adjustment | Reduce size pada counter-sentiment trades |
| Time Decay | Weighted score berdasarkan usia berita |

### 10. Trading Logger (`src/lib/trading-logger.ts`)

**1,600+ baris** — Structured logging system.

| Fitur | Deskripsi |
|-------|-----------|
| 6 Level | DEBUG, INFO, WARN, ERROR, CRITICAL, FATAL |
| 11 Category | MT5_CONNECTION, TRADE_EXECUTION, RISK_MANAGEMENT, dll. |
| Error Dedup | Fingerprint-based deduplication |
| Log Rotation | Configurable retention, lazy cleanup |
| Rate Limit Tracking | Monitoring API call rates |
| Analytics | Error rate trend, burst detection, top messages |

---

## Data Flow

### Trade Lifecycle

```
User/AI Request
    │
    ▼
┌─────────────────┐
│  Pre-Trade Check │ ← Risk Engine (margin, limits, sentiment)
└────────┬────────┘
         │ PASS
         ▼
┌─────────────────┐
│ Position Sizing  │ ← Money Management (method, scaling, reserve)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Execute Trade    │ ← MT5 Connection (async mutex, retry)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  DB Persist      │ ← Atomic updateMany with status check
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Monitoring      │ ← Price Update Pipeline (trailing, SL/TP)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Close Trade     │ ← SL/TP trigger, manual close, or emergency
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Post-Trade      │ ← Update daily perf, session perf, audit trail
└─────────────────┘
```

### AI Decision Flow

```
Request (symbol + timeframe)
    │
    ▼
┌─────────────────┐
│ Technical Analysis│ ← Indicator Pool (10 indicators)
└────────┬────────┘
         │
┌────────┴────────┐
│ News Impact     │ ← News API (Finnhub/Marketaux)
└────────┬────────┘
         │
┌────────┴────────┐
│ Sentiment       │ ← Sentiment Filter (NLP lexicon)
└────────┬────────┘
         │
┌────────┴────────┐
│ Risk Context    │ ← Risk Engine (limits, drawdown)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Weighted Score   │ → 50% tech + 25% news + 25% sentiment
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Confidence Check │ → min 65% for BUY/SELL
└────────┬────────┘
         │
         ▼
  Decision: BUY | SELL | HOLD | SKIP | REDUCE | CLOSE_ALL
```

### Price Update Pipeline

```
Price Update (symbol → price)
    │
    ▼
┌──────────────────┐
│ 1. Update Prices  │  Update currentPrice on all open trades for symbol
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 2. Trailing Stops │  Evaluate and adjust SL for trailing-enabled trades
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 3. SL/TP Triggers │  Close trades hitting stop-loss or take-profit
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 4. Partial Close  │  Evaluate scaled exit levels
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 5. Price Alerts   │  Evaluate and trigger price alerts
└──────────────────┘
```

---

## Database Schema

### Model Categories

| Kategori | Model | Deskripsi |
|----------|-------|-----------|
| **Trading** | Trade, PendingOrder | Data trade dan order |
| **MT5** | Mt5ConnectionState, Mt5ConnectionLog, Mt5ErrorCode | Koneksi broker |
| **Risk** | RiskEvent, RiskConfig | Manajemen risiko |
| **Performance** | DailyPerformance, SessionPerformance | Tracking performa |
| **AI** | AiAnalysis, AiDecisionConfig, DecisionLog | AI dan keputusan |
| **News** | NewsArticle, NewsSourceConfig, NewsFetchLog | Berita dan sentimen |
| **Sentiment** | SentimentSnapshot, SentimentKeyword | Analisis sentimen |
| **Alerts** | PriceAlert | Notifikasi harga |
| **Logging** | TradingLog | Structured logs |
| **System** | SystemConfig, AuditTrail, EscalationEvent, ApiRateLimit | Konfigurasi dan audit |
| **Data** | CandleData, BacktestResult | Data historis |
| **Notifications** | EmailNotification | Notifikasi email |

**Total: 20 model** — Lihat `prisma/schema.prisma` untuk detail lengkap.

### Key Relationships

```
Trade ──→ PriceAlert (via symbol)
Trade ──→ DailyPerformance (via date)
Trade ──→ SessionPerformance (via date + session)
Trade ──→ DecisionLog (via symbol)
Trade ──→ TradingLog (via tradeId)

NewsArticle ──→ SentimentSnapshot (via symbol)
NewsSourceConfig ──→ NewsFetchLog (via provider)
RiskConfig ──→ RiskEvent (triggered by config)
Mt5ConnectionState ──→ Mt5ConnectionLog (events)
```

---

## API Architecture

### Design Principles

| # | Prinsip | Deskripsi |
|---|---------|-----------|
| 1 | **Uniform Response** | Semua endpoint mengembalikan `{ success: boolean, data?: T, error?: string }` |
| 2 | **RESTful Resources** | Standard HTTP methods: GET (read), POST (create/execute), PUT (update), PATCH (partial update), DELETE (remove) |
| 3 | **Server-Side Only** | Semua business logic berjalan di API routes. Tidak ada client-side trading logic. |
| 4 | **Single-User Design** | Sistem dirancang untuk single-user (personal trading). |
| 5 | **Input Validation** | Input validation via Zod schemas dan manual checks. |

### Rate Limiting

| Service | Limit | Implementation |
|---------|-------|----------------|
| Finnhub API | 60 calls/min | In-memory tracking via ApiRateLimit model |
| MARKETAUX API | 100 calls/day | In-memory tracking via NewsSourceConfig model |
| Internal API | Tidak dibatasi | Single-user system |

### Error Handling

```typescript
// Standard error response
{ success: false, error: "Deskripsi error" }

// Validation error (422)
{ success: false, error: "Validation failed: ..." }

// Not found (404)
{ success: false, error: "Trade not found" }

// Risk rejection (422)
{ success: false, error: "Risk check failed: daily limit reached" }
```

Lihat [API.md](./API.md) untuk dokumentasi lengkap semua 58 endpoints.

---

## State Management

### Client-Side (React)

| State | Solution | Scope |
|-------|----------|-------|
| UI State | React `useState`/`useReducer` | Komponen lokal |
| Server State | `fetch()` + `useEffect` | Data dari API |
| Notifications | Custom `useLiveNotifications` hook | Toast notifications |
| Theme | `next-themes` | Dark/light mode |

### Server-Side (Database)

| State | Storage | Scope |
|-------|---------|-------|
| Trading State | SQLite (Trade model) | Persistent |
| Configuration | SQLite (RiskConfig, AiDecisionConfig, SystemConfig) | Persistent |
| MT5 Connection | SQLite + In-memory | Hybrid |
| Cache | In-memory Maps | Ephemeral |

---

## Error Handling Strategy

### Layer 1: Input Validation

- Zod schemas untuk request body validation
- Manual checks untuk business rules
- Early return dengan `{ success: false, error }` pada invalid input

### Layer 2: Business Logic Errors

- Risk engine rejection → 422 status code
- Trade state machine enforcement
- Atomic `updateMany` precondition checks

### Layer 3: External Service Errors

- Circuit breaker pattern (MT5, Finnhub, Marketaux)
- Exponential backoff retry (MT5 orders)
- Graceful degradation (fallback ke mock data jika tidak ada candle data)

### Layer 4: Logging & Escalation

- Structured logging ke database (6 severity levels x 11 categories)
- Error deduplication via fingerprint
- Escalation pipeline: logged → alert → recovery → emergency action
- Audit trail untuk semua perubahan konfigurasi

---

## Caching Strategy

### In-Memory Caches

| Cache | Location | Size Limit | Eviction | TTL |
|-------|----------|------------|----------|-----|
| Indicator Pool | `indicator-pool.ts` | 500 entries | FIFO | 30s default |
| API Route Pool | `api/indicators/compute/route.ts` | 50 pools | FIFO | Per-request |
| MT5 Connection State | `mt5-connection.ts` | Singleton | N/A | Refresh on heartbeat |
| News API LRU | `news-api.ts` | Configurable | LRU | 5-15 min |
| Log Stats | `api/logs/route.ts` | Singleton | TTL | 10s stats, 30s analytics |

### Database as Cache

| Data | Model | Retention |
|------|-------|-----------|
| Candle Data | CandleData | Unlimited (indexed) |
| Sentiment | SentimentSnapshot | Per-symbol time series |
| News | NewsArticle | All fetched articles |
| Performance | DailyPerformance | Daily records |

---

## Concurrency & Race Conditions

### Atomic Update Pattern

Race condition paling kritis: double-close trade (dua request mencoba menutup trade yang sama secara bersamaan).

**Solusi:**

```typescript
// Gunakan updateMany dengan WHERE precondition
const count = await db.trade.updateMany({
  where: {
    id: tradeId,
    status: { in: ['OPEN', 'PARTIAL_FILLED'] }  // Precondition
  },
  data: { status: 'CLOSED', closePrice, pnl, ... }
})

// Hanya lanjutkan jika 1 row terupdate
if (count === 0) {
  // Trade sudah ditutup oleh request lain — skip
  return
}
```

### MT5 Async Mutex

Semua MT5 API calls diserialisasi via `AsyncMutex` karena Python MT5 module tidak thread-safe:

```typescript
const release = await mt5Mutex.acquire()
try {
  result = await callMt5Api(params)
} finally {
  release()
}
```

---

## Timezone Handling

### Standard Pattern

Semua datetime yang ditampilkan ke user menggunakan **WIB (UTC+7)**. Pattern standar:

```typescript
// Konversi ke WIB date string (YYYY-MM-DD)
const wibDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta'
}).format(new Date())

// Konversi ke WIB time string (HH:mm)
const wibTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit'
}).format(new Date())
```

### Mengapa Intl.DateTimeFormat?

- Tidak memerlukan dependensi tambahan (built-in JavaScript)
- Otomatis handle DST (meskipun Indonesia tidak menggunakan DST)
- Konsisten di semua module
- Database menyimpan UTC, konversi ke WIB hanya saat display

---

## 7 Trading Strategies

| # | Strategi | Indikator Utama | Sinyal |
|---|----------|----------------|--------|
| 1 | MA Ribbon | EMA 8/13/21/34/55/89 | Golden/Death cross + ribbon alignment |
| 2 | Momentum Scalping | RSI + MACD | RSI oversold/overbought + MACD divergence |
| 3 | Pivot Point | Pivot + S1/R1/S2/R2 | Bounce dari support/resistance |
| 4 | EMA Crossover | EMA 12/26 | Fast EMA crosses slow EMA |
| 5 | RMI Trend Sync | RMI + ADX | Trend strength + momentum sync |
| 6 | Linear Regression | Linear Regression + StdDev | Channel breakout |
| 7 | EMA/RSI Filter | EMA 50 + RSI 14 | Trend direction + momentum confirmation |
