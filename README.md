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
| **MT5 Integration** | MetaTrader 5 via Python bridge |
| **Async Mutex** | Serialisasi semua MT5 API calls (thread-safety) |
| **Circuit Breaker** | Auto-reconnect dengan exponential backoff (1s → 30s) |
| **Error Code Mapping** | MT5 codes 10004-10036 dengan auto-remediation |

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
| Baris kode TypeScript | 27,300+ |
| File API route | 38 |
| HTTP endpoint handlers | 58 |
| Database model (Prisma) | 20 |
| Core business modules | 10 |
| Trading UI components | 15 |
| shadcn/ui components | 50+ |
| Trading strategies | 7 |
| Technical indicators | 10 |
| Audit & optimization phases | 8 |

---

## Lisensi

Proyek ini bersifat **private** dan **proprietary**. Hak cipta dilindungi. Lihat file LICENSE untuk detail.
