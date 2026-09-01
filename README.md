# FINEX AI Trader

> **Automated AI Trading System for Indonesian Stock Market (IDX) via MetaTrader 5**

FINEX AI Trader adalah sistem trading otomatis yang terintegrasi dengan broker **FINEX Indonesia** melalui **MetaTrader 5 (MT5)**. Sistem ini menggabungkan analisis teknikal, AI decision engine, sentimen berita, dan manajemen risiko dalam satu platform yang komprehensif.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Bun](https://img.shields.io/badge/Bun-1.3-orange?logo=bun)
![Prisma](https://img.shields.io/badge/Prisma-6-green?logo=prisma)
![SQLite](https://img.shields.io/badge/SQLite-3-blue?logo=sqlite)

---

## 📋 Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Tech Stack](#-tech-stack)
- [Prasyarat](#-prasyarat)
- [Instalasi Cepat](#-instalasi-cepat)
- [Konfigurasi Environment](#-konfigurasi-environment)
- [Menjalankan Aplikasi](#-menjalankan-aplikasi)
- [Struktur Proyek](#-struktur-proyek)
- [Dokumentasi](#-dokumentasi)
- [Spesifikasi Broker FINEX](#-spesifikasi-broker-finex)
- [Lisensi](#-lisensi)

---

## ✨ Fitur Utama

### 🤖 AI & Analisis
- **AI Decision Engine** — Sintesis 4 faktor (teknikal 50%, sentimen 25%, berita 25%, risiko) dengan confidence scoring
- **Self-Learning ML** — Feedback loop adaptif, kalibrasi confidence, dan weight adjustment otomatis
- **Sentiment Analysis** — NLP lexicon 140+ kata (EN + ID), 5 regime (Bullish/Extreme Greed/Neutral/Extreme Fear/Bearish)
- **News Integration** — Finnhub & MARKETAUX dengan rate limiting, circuit breaker, deduplication, breaking news detection

### 📊 Trading & Eksekusi
- **7 Strategi Trading** — MA Ribbon, Momentum Scalping, Pivot Point, EMA Crossover, RMI Trend Sync, Linear Regression Channels, EMA/RSI Filter
- **10 Technical Indicators** — SMA, EMA, RSI, MACD, ATR, Bollinger Bands, Stochastic, ADX, VWAP, Pivot Points
- **Trade Execution Engine** — State machine, atomic updates, SL/TP otomatis, trailing stop tiered, partial close
- **Position Sizing** — 4 metode: Fixed Fractional, Kelly Criterion, Fixed Dollar, Anti-Martingale

### 🛡️ Risk Management
- **Multi-Layer Risk** — Pre-trade check, margin monitoring, daily/weekly/monthly loss limits
- **Proactive Margin Call** — Warning zone 70%, strong warning 60% (reduce 50%)
- **Gap Risk Analysis** — Assessment risiko overnight gap
- **Volatility Regime** — Dynamic risk scaling berdasarkan volatilitas pasar
- **Consecutive Loss Halt** — Auto-halt setelah N kerugian beruntun
- **Equity Curve Monitoring** — Halt trading saat equity di bawah moving average

### 📈 Monitoring & Reporting
- **Real-time Dashboard** — Account summary, equity chart, watchlist 20 saham IDX
- **Session Manager** — IDX trading sessions (Pre-market, S1, Lunch, S2, Post-close) WIB
- **Performance Reports** — Win rate, profit factor, Sharpe ratio, max drawdown, commission tracking
- **Audit Trail** — Lengkap dengan escalation pipeline dan compliance reporting
- **Backtesting** — Simulasi strategi dengan data historis candle

### 🔗 Koneksi Broker
- **MT5 Integration** — MetaTrader 5 via Python bridge
- **Async Mutex** — Serialisasi semua MT5 API calls (thread-safety)
- **Circuit Breaker** — Auto-reconnect dengan exponential backoff (1s → 30s)
- **Error Code Mapping** — MT5 codes 10004-10036 dengan auto-remediation

---

## 🛠 Tech Stack

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

## 📋 Prasyarat

### Software yang Diperlukan

| Software | Versi Minimum | Download |
|----------|---------------|----------|
| **Windows 11** | 22H2+ | Sudah terinstall |
| **Visual Studio Code** | 1.85+ | [code.visualstudio.com](https://code.visualstudio.com/) |
| **Bun** | 1.3.x | [bun.sh](https://bun.sh/) |
| **Git** | 2.40+ | [git-scm.com](https://git-scm.com/) |
| **MetaTrader 5** | Build 4000+ | Dari broker FINEX Indonesia |
| **Python** | 3.10+ | [python.org](https://www.python.org/) |

### VS Code Extensions yang Direkomendasikan

```text
- Tailwind CSS IntelliSense        (bradlc.vscode-tailwindcss)
- Prisma                         (prisma.prisma-vscode)
- ESLint                        (dbaeumer.vscode-eslint)
- TypeScript Import Sorter       (mitermayer.sort-imports)
- Prettier - Code formatter     (esbenp.prettier-vscode)
- Error Lens                     (usernamehw.errorlens)
- GitLens — Git supercharged     (eamodio.gitlens)
- Thunder Client                 (rangav.vscode-thunder-client)
```

### Akun & API Keys

- Akun trading **FINEX Indonesia** (Real atau Demo)
- **Finnhub API Key** — Untuk news feed ([finnhub.io](https://finnhub.io/))
- **MARKETAUX API Key** — Untuk news alternatif ([marketaux.com](https://www.marketaux.com/))

---

## 🚀 Instalasi Cepat

### 1. Clone Repository

```bash
git clone https://github.com/teekar2312/frxai.git
cd frxai
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Setup Environment

```bash
copy .env.example .env
```

Edit `.env` sesuai konfigurasi anda (lihat [Konfigurasi Environment](#-konfigurasi-environment)).

### 4. Setup Database

```bash
bun run db:generate
bun run db:push
bun run prisma db seed
```

### 5. Jalankan Development Server

```bash
bun run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser.

---

## ⚙️ Konfigurasi Environment

Buat file `.env` di root project:

```env
# ============================================
# DATABASE
# ============================================
DATABASE_URL="file:./db/custom.db"

# ============================================
# FINEX MT5 CONNECTION
# ============================================
MT5_LOGIN="your_account_number"
MT5_PASSWORD="your_account_password"
MT5_SERVER="FINEX-Server"

# ============================================
# NEWS API PROVIDERS
# ============================================
FINNHUB_API_KEY="your_finnhub_api_key"
MARKETAUX_API_KEY="your_marketaux_api_key"

# ============================================
# SYSTEM
# ============================================
BASE_BALANCE="10000"
NODE_ENV="development"
```

> ⚠️ **PENTING**: Jangan pernah commit file `.env` ke repository. File ini sudah ada di `.gitignore`.

---

## ▶️ Menjalankan Aplikasi

### Development Mode

```bash
bun run dev
```
Server berjalan di `http://localhost:3000` dengan hot-reload.

### Production Build

```bash
bun run build
bun run start
```
Server produksi berjalan di port 3000.

### Database Commands

```bash
# Generate Prisma Client
bun run db:generate

# Push schema ke database (dev)
bun run db:push

# Migrate database
bun run db:migrate

# Reset database (hapus semua data)
bun run db:reset
```

### Linting

```bash
bun run lint
```

---

## 📁 Struktur Proyek

```
frxai/
├── prisma/
│   ├── schema.prisma          # Database schema (20 models)
│   └── seed.ts                # Seed data
├── db/
│   └── custom.db              # SQLite database
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Main trading dashboard (SPA)
│   │   ├── globals.css        # Global styles
│   │   └── api/               # API Routes (37 files, 62 handlers)
│   │       ├── account/       # Account summary & equity curve
│   │       ├── ai/            # AI decision engine & accuracy
│   │       ├── alerts/        # Price alerts CRUD
│   │       ├── analysis/      # AI market analysis
│   │       ├── audit/         # Compliance audit report
│   │       ├── backtest/      # Strategy backtesting
│   │       ├── execution/     # Trade execution, trailing, emergency
│   │       ├── indicators/    # Technical indicator computation
│   │       ├── logs/          # Trading logs & export
│   │       ├── money-management/ # Position sizing & daily performance
│   │       ├── mt5/           # MT5 connection & status
│   │       ├── news/          # News fetching & sentiment scoring
│   │       ├── reports/       # Performance reports
│   │       ├── risk/          # Risk management & gap risk
│   │       ├── risk-events/   # Risk event management
│   │       ├── sentiment/     # Sentiment snapshot & filter
│   │       ├── sessions/      # Trading sessions & performance
│   │       ├── stocks/        # Stock watchlist
│   │       ├── strategies/    # Strategy signals
│   │       ├── system/        # System configuration
│   │       └── trades/        # Trade CRUD & history
│   ├── components/
│   │   ├── trading/           # 15 trading UI components
│   │   └── ui/                # 50+ shadcn/ui components
│   ├── hooks/                 # Custom React hooks
│   └── lib/                   # Core business logic (10 modules)
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
├── next.config.ts                 # Next.js configuration
├── tailwind.config.ts             # Tailwind CSS configuration
├── tsconfig.json                  # TypeScript configuration
├── eslint.config.mjs              # ESLint configuration
├── package.json                   # Dependencies & scripts
├── Caddyfile                      # Reverse proxy config
└── README.md                      # This file
```

---

## 📚 Dokumentasi

| Dokumen | Deskripsi |
|---------|-----------|
| [README.md](./README.md) | Overview, instalasi, dan quick start |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Desain arsitektur sistem |
| [API.md](./API.md) | Dokumentasi lengkap API endpoints |
| [SECURITY.md](./SECURITY.md) | Panduan keamanan |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Panduan kontribusi |
| [CHANGELOG.md](./CHANGELOG.md) | Riwayat perubahan versi |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Panduan deployment (VS Code + Windows 11) |

---

## 🏦 Spesifikasi Broker FINEX

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

### Jam Trading IDX (WIB/UTC+7)

| Sesi | Waktu | Keterangan |
|------|-------|------------|
| Pre-Market | 09:00 - 09:05 | Pre-open auction |
| Session 1 | 09:05 - 11:30 | Morning session |
| Lunch Break | 11:30 - 13:00 | Market closed |
| Session 2 | 13:00 - 16:15 | Afternoon session |
| Post-Close | 16:15 - 17:00 | Post-close auction |

### Daftar Saham yang Didukung

20 saham IDX populer termasuk: BBRI, BBCA, BMRI, BBNI, TLKM, ASII, UNVR, GOTO, BUKA, ACST, ADRO, ANTM, BRIS, BRPT, EMTK, INCO, MDKA, PTBA, TINS, VALE.

---

## 📊 Stats

- **27,300+** baris kode TypeScript
- **37** file API route dengan **62** handler
- **20** database model (Prisma)
- **10** modul business logic
- **15** komponen trading UI
- **50+** komponen shadcn/ui
- **7** strategi trading
- **10** indikator teknikal
- **5** fase audit & optimasi selesai

---

## ⚖️ Lisensi

Proyek ini bersifat **private** dan **proprietary**. Hak cipta dilindungi. Lihat file LICENSE untuk detail.
