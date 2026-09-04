# FINEX AI Trader

> **Sistem Trading Otomatis AI untuk Pasar Saham Indonesia (IDX) via MetaTrader 5**

FINEX AI Trader adalah sistem trading otomatis yang terintegrasi dengan broker **FINEX Indonesia** melalui **MetaTrader 5 (MT5)**. Sistem ini menggabungkan analisis teknikal, AI decision engine, sentimen berita, dan manajemen risiko dalam satu platform yang komprehensif.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Bun](https://img.shields.io/badge/Bun-1.3-orange?logo=bun)
![Prisma](https://img.shields.io/badge/Prisma-6-green?logo=prisma)
![SQLite](https://img.shields.io/badge/SQLite-3-blue?logo=sqlite)
![License](https://img.shields.io/badge/License-Private-red)
![Platform](https://img.shields.io/badge/Platform-Windows_11-0078D4?logo=windows)

---

## Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Tech Stack](#-tech-stack)
- [Prasyarat](#-prasyarat)
- [Instalasi Cepat](#-instalasi-cepat)
- [Konfigurasi Environment](#-konfigurasi-environment)
- [Menjalankan Aplikasi](#-menjalankan-aplikasi)
- [Struktur Proyek](#-struktur-proyek)
- [Dokumentasi Lengkap](#-dokumentasi-lengkap)
- [Spesifikasi Broker FINEX](#-spesifikasi-broker-finex)
- [Statistik Proyek](#-statistik-proyek)
- [Lisensi](#-lisensi)

---

## Fitur Utama

### AI & Analisis

| Fitur | Deskripsi |
|-------|----------|
| **AI Decision Engine** | Sintesis 4 faktor (teknikal 50%, sentimen 25%, berita 25%, risiko) dengan confidence scoring |
| **Self-Learning ML** | Feedback loop adaptif, kalibrasi confidence, dan weight adjustment otomatis |
| **Sentiment Analysis** | NLP lexicon 140+ kata (EN + ID), 5 regime (Bullish/Extreme Greed/Neutral/Extreme Fear/Bearish) |
| **News Integration** | Finnhub & MARKETAUX dengan rate limiting, circuit breaker, deduplication, breaking news detection |

### Trading & Eksekusi

| Fitur | Deskripsi |
|-------|----------|
| **7 Strategi Trading** | MA Ribbon, Momentum Scalping, Pivot Point, EMA Crossover, RMI Trend Sync, Linear Regression Channels, EMA/RSI Filter |
| **10 Technical Indicators** | SMA, EMA, RSI, MACD, ATR, Bollinger Bands, Stochastic, ADX, VWAP, Pivot Points |
| **Trade Execution Engine** | State machine, atomic updates, SL/TP otomatis, trailing stop tiered, partial close |
| **Position Sizing** | 4 metode: Fixed Fractional, Kelly Criterion, Fixed Dollar, Anti-Martingale |

### Risk Management

| Fitur | Deskripsi |
|-------|----------|
| **Multi-Layer Risk** | Pre-trade check, margin monitoring, daily/weekly/monthly loss limits |
| **Proactive Margin Call** | Warning zone 70%, strong warning 60% (reduce 50%) |
| **Gap Risk Analysis** | Assessment risiko overnight gap |
| **Volatility Regime** | Dynamic risk scaling berdasarkan volatilitas pasar |
| **Consecutive Loss Halt** | Auto-halt setelah N kerugian beruntun |
| **Equity Curve Monitoring** | Halt trading saat equity di bawah moving average |

### Monitoring & Reporting

| Fitur | Deskripsi |
|-------|----------|
| **Real-time Dashboard** | Account summary, equity chart, watchlist 20 saham IDX |
| **Session Manager** | IDX trading sessions (Pre-market, S1, Lunch, S2, Post-close) WIB |
| **Performance Reports** | Win rate, profit factor, Sharpe ratio, max drawdown, commission tracking |
| **Audit Trail** | Lengkap dengan escalation pipeline dan compliance reporting |
| **Backtesting** | Simulasi strategi dengan data historis candle |

### Koneksi Broker

| Fitur | Deskripsi |
|-------|----------|
| **MT5 Integration** | HTTP bridge kontrak-tetap: **dev/demo** = simulator TypeScript (`mini-services/mt5-bridge`), **produksi** = bridge Python nyata (`python-bridge/`, library resmi MetaTrader5). Swap tanpa perubahan aplikasi |
| **Execution Lock** | Mutex global — serialisasi risk-check → order-write (race condition guard) |
| **Async Mutex** | Serialisasi semua MT5 API calls (thread-safety) |
| **Circuit Breaker** | Auto-reconnect dengan exponential backoff (1s → 30s) |
| **Error Code Mapping** | MT5 codes 10004-10036 dengan auto-remediation |
| **Secrets at Rest** | AES-256-GCM untuk botToken/webhookUrl notifikasi di DB |

---

## Tech Stack

| Komponen | Teknologi | Versi |
|----------|-----------|-------|
| Framework | Next.js (App Router) | 16.x |
| Bahasa | TypeScript | 5.x |
| Runtime | Bun | 1.3.x |
| Database | SQLite via Prisma ORM | 6.x |
| UI Library | shadcn/ui (New York) | Latest |
| Styling | Tailwind CSS | 4.x |
| Icons | Lucide React | Latest |
| Charts | Recharts | 2.x |
| Forms | React Hook Form + Zod | Latest |
| State | Zustand + TanStack Query | Latest |
| Animations | Framer Motion | 12.x |

---

## Prasyarat

### Software yang Diperlukan (Windows 11)

| Software | Versi Minimum | Download |
|----------|---------------|----------|
| **Windows 11** | 22H2+ | Sudah terinstall |
| **Visual Studio Code** | 1.85+ | [code.visualstudio.com](https://code.visualstudio.com/) |
| **Bun** | 1.3.x | [bun.sh](https://bun.sh/) |
| **Git** | 2.40+ | [git-scm.com](https://git-scm.com/) |
| **MetaTrader 5** | Build 4000+ | Dari broker FINEX Indonesia |
| **Python** | 3.10+ | [python.org](https://www.python.org/) |

### VS Code Extensions (Direkomendasikan)

Buka VS Code → Extensions (`Ctrl+Shift+X`) → install:

```
Tailwind CSS IntelliSense        (bradlc.vscode-tailwindcss)
Prisma                         (prisma.prisma-vscode)
ESLint                        (dbaeumer.vscode-eslint)
TypeScript Import Sorter       (mitermayer.sort-imports)
Prettier - Code formatter     (esbenp.prettier-vscode)
Error Lens                     (usernamehw.errorlens)
GitLens — Git supercharged     (eamodio.gitlens)
Thunder Client                 (rangav.vscode-thunder-client)
```

### Akun & API Keys

- Akun trading **FINEX Indonesia** (Real atau Demo)
- **Finnhub API Key** — [finnhub.io](https://finnhub.io/) (Free tier: 60 calls/min)
- **MARKETAUX API Key** — [marketaux.com](https://www.marketaux.com/) (Free tier: 100 calls/day)

---

## Instalasi Cepat

### Langkah 1: Clone Repository

Buka **VS Code** → Terminal (`Ctrl+```) → jalankan:

```bash
git clone https://github.com/teekar2312/frxai.git
cd frxai
code .
```

### Langkah 2: Install Dependencies

```bash
bun install
```

### Langkah 3: Setup Environment

```bash
copy .env.example .env
```

Buka file `.env` di VS Code dan isi sesuai konfigurasi Anda:

```env
DATABASE_URL="file:./db/custom.db"
MT5_LOGIN="your_mt5_account_number"
MT5_PASSWORD="your_mt5_account_password"
MT5_SERVER="FINEX-Server"
FINNHUB_API_KEY="your_finnhub_api_key"
MARKETAUX_API_KEY="your_marketaux_api_key"
BASE_BALANCE="10000"
NODE_ENV="development"
```

> **PENTING**: Jangan pernah commit file `.env` ke repository. File ini sudah ada di `.gitignore`.

### Langkah 4: Setup Database

```bash
bun run db:generate
bun run db:push
```

### Langkah 5: Jalankan Development Server

```bash
bun run dev
```

Buka browser di `http://localhost:3000`.

---

## Konfigurasi Environment

Buat file `.env` di root project dengan menyalin `.env.example`:

```bash
copy .env.example .env
```

| Variable | Wajib | Default | Deskripsi |
|----------|-------|---------|-----------|
| `DATABASE_URL` | Ya | `file:./db/custom.db` | Path database SQLite |
| `MT5_LOGIN` | Ya | — | Nomor akun MT5 FINEX |
| `MT5_PASSWORD` | Ya | — | Password akun MT5 FINEX |
| `MT5_SERVER` | Ya | `FINEX-Server` | Nama server broker |
| `FINNHUB_API_KEY` | Ya | — | API key Finnhub |
| `MARKETAUX_API_KEY` | Ya | — | API key MARKETAUX |
| `BASE_BALANCE` | Tidak | `10000` | Saldo dasar (USD) |
| `NODE_ENV` | Tidak | `development` | `development` atau `production` |

---

## Menjalankan Aplikasi

### Development Mode

```bash
bun run dev
```

Server berjalan di `http://localhost:3000` dengan hot-reload. Log output tersimpan di `dev.log`.

### Production Build

```bash
bun run build
bun run start
```

Server produksi berjalan di port 3000. Log output tersimpan di `server.log`.

### Database Commands

```bash
# Generate Prisma Client
bun run db:generate

# Push schema ke database (development)
bun run db:push

# Create migration
bun run db:migrate

# Reset database (hapus semua data)
bun run db:reset
```

### Linting

```bash
bun run lint
```

---

## Struktur Proyek

```
frxai/
├── prisma/
│   ├── schema.prisma          # Database schema (20 models)
│   └── seed.ts                # Seed data
├── db/
│   └── custom.db              # SQLite database
├── python-bridge/             # PRODUCTION MT5 bridge (Python + MetaTrader5, Windows)
│   ├── mt5_bridge.py          # FastAPI server — kontrak HTTP identik dengan simulator
│   ├── requirements.txt       # MetaTrader5, fastapi, uvicorn
│   └── README.md              # Panduan deploy & swap
├── mini-services/
│   └── mt5-bridge/            # DEV/DEMO bridge — simulator TypeScript (Bun)
│       ├── index.ts           # Simulasi broker: harga random-walk, order fill fake
│       └── supervisor.ts      # Watchdog auto-respawn (probe /heartbeat 5s)
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Main trading dashboard (SPA)
│   │   ├── globals.css           # Global styles
│   │   └── api/                  # 38 API route files, 58 handlers
│   │       ├── account/             # Account & equity curve
│   │       ├── ai/                  # AI decision & accuracy
│   │       ├── alerts/              # Price alerts CRUD
│   │       ├── analysis/            # AI market analysis
│   │       ├── audit/               # Compliance audit
│   │       ├── backtest/            # Strategy backtesting
│   │       ├── execution/           # Trade execution pipeline
│   │       ├── indicators/          # Technical computation
│   │       ├── logs/                # Trading logs & export
│   │       ├── money-management/    # Position sizing
│   │       ├── mt5/                 # MT5 connection
│   │       ├── news/                # News fetching
│   │       ├── reports/             # Performance reports
│   │       ├── risk/                # Risk management
│   │       ├── risk-events/         # Risk event management
│   │       ├── sentiment/            # Sentiment analysis
│   │       ├── sessions/            # Trading sessions
│   │       ├── stocks/              # Stock watchlist
│   │       ├── strategies/          # Strategy signals
│   │       ├── system/              # System configuration
│   │       └── trades/              # Trade CRUD & history
│   ├── components/
│   │   ├── trading/              # 15 trading UI components
│   │   └── ui/                   # 50+ shadcn/ui components
│   ├── hooks/                 # Custom React hooks
│   └── lib/                   # 10 core business modules
│       ├── ai-decision-engine.ts     # AI 4-factor decision synthesis
│       ├── config.ts                 # Centralized configuration
│       ├── db.ts                     # Prisma database client
│       ├── indicator-pool.ts         # 10 technical indicators
│       ├── money-management.ts       # Position sizing & performance
│       ├── mt5-connection.ts         # MT5 broker integration
│       ├── news-api.ts               # Finnhub/Marketaux integration
│       ├── risk-engine.ts            # Risk validation & monitoring
│       ├── sentiment-filter.ts       # NLP sentiment analysis
│       ├── session-manager.ts        # IDX trading sessions
│       ├── trade-execution-engine.ts # Trade lifecycle management
│       ├── trading-logger.ts         # Structured logging
│       ├── notification-hooks.ts     # Live notifications
│       └── utils.ts                  # Utility functions
├── public/
│   ├── logo.svg
│   └── robots.txt
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── eslint.config.mjs
├── package.json
├── Caddyfile
├── .env.example
└── README.md
```

---

## Dokumentasi Lengkap

| Dokumen | Deskripsi |
|---------|-----------|
| [README.md](./README.md) | Overview, instalasi, dan quick start |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Desain arsitektur sistem, data flow, modul |
| [API.md](./API.md) | Dokumentasi lengkap 58 API endpoints |
| [SECURITY.md](./SECURITY.md) | Panduan keamanan dan best practices |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Panduan kontribusi dan coding standards |
| [CHANGELOG.md](./CHANGELOG.md) | Riwayat perubahan versi |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Panduan deployment lengkap (VS Code + Windows 11) |

---

## Spesifikasi Broker FINEX

| Parameter | Nilai |
|-----------|-------|
| Broker | FINEX Indonesia |
| Platform | MetaTrader 5 |
| Leverage | 1:25 |
| Spread | Mulai 0.5 pip |
| Commission | $1 per lot |
| Margin Call Level | 50% |
| Stop Out Level | 20% |
| Proactive MC Warning | 70% (warning), 60% (reduce 50%) |
| Max Order | 50 lots per trade |
| Max Open Positions | 200 |
| Market | IDX (Indonesian Stock Exchange) |

### Jam Trading IDX (WIB / UTC+7)

| Sesi | Waktu (WIB) | Keterangan |
|------|-------------|------------|
| Pre-Market | 09:00 - 09:05 | Pre-open auction |
| Session 1 | 09:05 - 11:30 | Morning session |
| Lunch Break | 11:30 - 13:00 | Market closed |
| Session 2 | 13:00 - 16:15 | Afternoon session |
| Post-Close | 16:15 - 17:00 | Post-close auction |

### Daftar Saham yang Didukung (20 Saham IDX)

BBRI, BBCA, BMRI, BBNI, TLKM, ASII, UNVR, GOTO, BUKA, ACST, ADRO, ANTM, BRIS, BRPT, EMTK, INCO, MDKA, PTBA, TINS, VALE

---

## Statistik Proyek

| Metrik | Jumlah |
|--------|--------|
| Baris kode TypeScript | 30,000+ |
| File API route | 42 |
| HTTP endpoint handlers | 66+ |
| Database model (Prisma) | 25 |
| Core business modules | 18 |
| Trading UI components | 16 |
| Unit tests (bun test) | 367 test / 5,300+ assertions |
| Trading strategies (backtest engine) | 6 engine nyata |
| Technical indicators | 10 |
| Audit & optimization phases | 9 |

---

## Hardening v2.0 — Reliability, Testing & Observability

> Peningkatan menyeluruh hasil audit prioritas: unit tests, env validation,
> retry transient failures, rate limiting, log rotation, circuit breaker
> persisten, configuration hierarchy, notifikasi Telegram/Discord,
> backtest engine lengkap, dan monitoring/observability.

### Refactor v2.1.0 — Modular Architecture & Zero tsc Errors

| Aspek | Hasil v2.1.0 | Detail |
|-------|--------------|--------|
| File >1.700 baris | **5 engine → 50 modul domain** (facade pattern) | `src/lib/ai/` (14), `src/lib/mt5/` (7), `src/lib/execution/` (10), `src/lib/risk/` (12), `src/lib/indicators/` (7) — semua import path lama tetap berfungsi, zero consumer diubah, per-part diverifikasi byte-identical |
| `tsc --noEmit` | **54 → 0 error** repo-wide | `bun:test` resolution via `tests/globals.d.ts` (bun-types), mini-service dapat tsconfig sendiri (10 → 0), 2 bug laten ditemukan & diperbaiki (POST /api/trades "not iterable", snapshot manual trade tanpa symbol) |
| ESLint | **Aturan keamanan diaktifkan, 124 error → 0** | `no-unused-vars`, `prefer-const`, `no-debugger`, `no-unreachable`, `no-redeclare`, `no-fallthrough` — 44 file dibersihkan dari dead code/imports |
| Pattern umum | `di.ts` + `api-query.ts` + `db-utils.ts` | Service locator testable untuk db/logger, `parsePagination()` standar (menggantikan 8 varian parsing manual), `getAccountEquity()` shared |
| Tests | **434/434 pass** (16 file) | +33 test baru (DI semantics, pagination edge cases, fake-DB injection) |

### Hardening v2.0.1 — Type Safety & Recovery Hints

| Isu Audit | Solusi v2.0.1 | Status |
|-----------|----------------|--------|
| `as any` / `: any` menghilangkan type safety | **Zero `any` di `src/`** (16 dieliminasi): Zod strict schema di route config, factory `default*Factors()`, `Prisma.*GetPayload` (`TradeRecord`/`PendingOrderRecord`), narrowing union | ✅ |
| `console.log` di production code | Semua di `src/` kini justifiable (logger internals/bootstrap/React boundary); ringkasan rotasi log dialihkan ke `logger.info` → terlihat di UI System Logs | ✅ |
| Error handling log-tanpa-recovery | `src/lib/api-errors.ts` — 13 route kritis mengembalikan `{ code, recovery, retryable, retryAfterMs }` terklasifikasi (Zod/Prisma/CB/retry/market-closed) | ✅ |
| Timer cleanup component | Audit menyeluruh: seluruh `useEffect` timer sudah punya cleanup return (terverifikasi manual per komponen) | ✅ |
| `bun:test` 401 test | +34 test `api-errors.test.ts` (klasifikasi semua domain error) | ✅ |

### Ringkasan Perbaikan

| # | Isu Audit | Prioritas | Solusi v2 | Status |
|---|-----------|-----------|-----------|--------|
| 1 | Tidak ada unit tests | CRITICAL | 13 file test bun, 367 test, modul baru 81–100% coverage | ✅ |
| 2 | Environment tidak divalidasi | CRITICAL | `env-validation.ts` — Zod runtime validation, fail-fast prod, warning dev | ✅ |
| 3 | Bridge request tanpa retry | CRITICAL | `retry.ts` — exponential backoff + full jitter + transient classifier | ✅ |
| 4 | Rate limiting API belum ada | HIGH | `middleware.ts` global (READ/WRITE/AI/DRAFT tier) + 429 + Retry-After | ✅ |
| 5 | Log rotation tidak konfigurable | HIGH | `LOG_RETENTION_DAYS`, `MT5_LOG_RETENTION_DAYS`, `NEWS_LOG_RETENTION_DAYS`, `LOG_CLEANUP_INTERVAL_HOURS` | ✅ |
| 6 | Circuit breaker hilang saat restart | HIGH | Auto-persist tiap transisi + restore age-aware saat boot | ✅ |
| 7 | Configuration management | MEDIUM | `app-config.ts` — 4-layer (default→env→DB→runtime) + hot reload + audit | ✅ |
| 8 | Notification hooks inkomplit | MEDIUM | Telegram Bot API + Discord webhook, filter, rate cap, retry, log persist | ✅ |
| 9 | Backtest module minimal | MEDIUM | 6 engine nyata (tanpa mock), 15+ metrics, per-trade ledger, synthetic fallback | ✅ |
| 10 | Monitoring & observability kurang | MEDIUM | `/api/health` (liveness+readiness), `/api/metrics` (JSON+Prometheus) | ✅ |

### Testing

```bash
bun test                  # 401 test, 100% pass
bun test --coverage       # laporan coverage per file
bun run lint              # 0 error
```

Coverage modul v2: `backtest-engine` **100%**, `env-validation` **100%**, `retry` **100%**, `rate-limit` **92%**, `indicator-pool` **91%**, `metrics` **84%**, `app-config` **81%** (lines).

### Endpoint Monitoring Baru

| Endpoint | Fungsi |
|----------|--------|
| `GET /api/health?type=liveness` | Probe hidup (DB touch) |
| `GET /api/health?type=readiness` | Sweep penuh: DB, MT5 bridge, memori, disk + audit log |
| `GET /api/metrics` | Snapshot JSON: counter, gauge, histogram p50/p95/p99 |
| `GET /api/metrics?format=prometheus` | Eksposisi Prometheus text |
| `GET /api/config?scope=…` | Inspeksi konfigurasi 4-layer |
| `PATCH /api/config` | Override runtime (persisted + audit trail) |
| `GET/PUT /api/notifications/config` | Konfigurasi channel Telegram/Discord |
| `POST /api/notifications/test` | Kirim notifikasi uji |

### Contoh Environment Tambahan (v2)

Lihat `.env.example` untuk daftar lengkap — di antaranya:
`BRIDGE_MAX_RETRIES`, `CB_FAILURE_THRESHOLD`, `RATE_LIMIT_*`,
`LOG_RETENTION_DAYS`, `TELEGRAM_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`,
`METRICS_SNAPSHOT_INTERVAL_MS`, `BACKTEST_MAX_CANDLES`.

---

## Lisensi

Proyek ini bersifat **private** dan **proprietary**. Hak cipta dilindungi. Lihat file LICENSE untuk detail.
