# FXQuant AI — FINEX Indonesia Trading Terminal

Dashboard trading forex & emas berbasis AI untuk broker **FINEX Indonesia**, dengan analisa multi-faktor real-time, manajemen risiko otomatis, 30 indikator scalping, backtesting, dan integrasi MetaTrader 5.

> **Peringatan Risiko**: Trading forex & CFD berisiko tinggi. Anda bisa kehilangan seluruh modal. Lakukan backtest dan gunakan risk management ketat. Mulai dengan akun demo.

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Tech Stack](#tech-stack)
- [Spesifikasi Broker FINEX Indonesia](#spesifikasi-broker-finex-indonesia)
- [Arsitektur Sistem](#arsitektur-sistem)
- [Instalasi & Setup](#instalasi--setup)
- [Penggunaan](#penggunaan)
- [Struktur Proyek](#struktur-proyek)
- [Dokumentasi Lengkap](#dokumentasi-lengkap)
- [Keamanan](#keamanan)
- [Lisensi](#lisensi)

---

## Fitur Utama

### AI Multi-Faktor (Real LLM)
Analisa pasar menggunakan Large Language Model (z-ai-web-dev-sdk) yang menganalisa 7 faktor secara komprehensif untuk setiap pair:
1. Kebijakan Bank Sentral (ECB, Fed, BoJ, BoE)
2. Data Ekonomi Utama (NFP, CPI, PPI, GDP, Unemployment, Retail Sales, PMI)
3. Kondisi Politik & Geopolitik
4. Kebijakan Fiskal & Ekonomi
5. Harga Komoditas (minyak, emas, dll.)
6. Sentimen Pasar
7. Berita Dadakan / Breaking News

Tombol **"Analisa Semua Pair"** menganalisa seluruh pair aktif secara paralel, menghasilkan sinyal BUY/SELL/NEUTRAL + confidence + heatmap 7 faktor + Entry/SL/TP. Hasil analisa disimpan untuk self-learning AI.

### Pair & Instrumen
- **EURUSD** — Euro / US Dollar
- **USDJPY** — US Dollar / Japanese Yen
- **GBPUSD** — Pound / US Dollar
- **XAUUSD** — Gold / US Dollar

### Sesi Trading
Sydney, Tokyo, London, New York, plus overlap London+NewYork dan NewYork+Tokyo. Trading otomatis dihentikan pada hari Sabtu & Minggu.

### Multiple Timeframe
M1, M5, M15, M30, H1, H4, D1 — bisa pilih lebih dari satu.

### 30 Indikator Pool
Lihat [docs/INDICATORS.md](docs/INDICATORS.md) untuk daftar lengkap & konfigurasi scalping.

### Manajemen Risiko
- Risk per trade: 0.5%–1%
- Stop loss: 5–15 pip
- Risk:Reward = 1:1.5
- Maksimal 1–3 posisi terbuka bersamaan
- Daily risk limit (Anti-MC): 2%–3%
- Kalkulator lot size otomatis
- Lihat [docs/RISK-MANAGEMENT.md](docs/RISK-MANAGEMENT.md)

### Trading Manual & Otomatis
- Order manual (symbol, side, lot, SL, TP, trailing stop)
- **AI auto-trade** — toggle ON di top bar, scheduler berjalan tiap 90 detik: analisa AI multi-faktor per pair (round-robin) + eksekusi otomatis jika sinyal kuat (confidence ≥ 55%) + lot sizing otomatis dari risk config
- **Trailing stop otomatis** — saat `trailingAuto` ON, AI trades otomatis dapat trailing stop; poller 5 detik menggeser SL toward price (ratchet)
- **AI auto-select indikator** — saat `indicatorAuto` ON, 5 indikator scalping optimal (EMA, RSI, ATR, Supertrend, Bollinger Bands) diaktifkan otomatis
- **AI auto-adjust risiko** — saat `riskAuto` ON, `riskPerTrade` disesuaikan berdasarkan performa (turun setelah 3 loss beruntun, naik saat win streak)
- **Weekend & session gate** — `avoidWeekends` + `sessions` memblokir trading di luar jam/market yang dikonfigurasi (berlaku untuk manual + auto)
- Pemilihan indikator/sesi/timeframe/pair manual atau otomatis oleh AI

### Integrasi MT5
- Input kredensial akun MT5 (nomor akun, password, server, tipe demo/real)
- Launch aplikasi terminal MT5 (`terminal64.exe`) dari dashboard
- Auto-start terminal sebelum connect bridge
- Connect/disconnect bridge
- Lihat [docs/MT5-BRIDGE.md](docs/MT5-BRIDGE.md)

### Fitur Tambahan
- Backtesting engine (4 strategi: EMA Crossover, Momentum Breakout, Mean Reversion, AI Hybrid)
- Alert harga, notifikasi email, alert berita dadakan
- Logging error/trade/AI dengan filter & search
- Dark/light theme (default: dark trading terminal)

---

## Tech Stack

| Komponen | Teknologi |
|---|---|
| Framework | Next.js 16 (App Router) |
| Bahasa | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| UI Components | shadcn/ui (New York) + Lucide icons |
| State Management | Zustand (client) |
| Database | Prisma ORM + SQLite |
| Charts | Recharts |
| Animasi | Framer Motion |
| Notifications | Sonner (toasts) |
| AI | z-ai-web-dev-sdk (LLM, server-only) |
| Runtime | Bun |
| Theme | next-themes |

---

## Spesifikasi Broker FINEX Indonesia

| Parameter | Nilai |
|---|---|
| Leverage Forex & Logam | 1:500 |
| Spread | Mengambang dari 0.5 pip |
| Komisi | $1 per lot |
| Volume minimum | 0.01 lot |
| Volume maksimum per order | 50 lot |
| Posisi terbuka maksimum | 200 |
| Margin Call | 50% |
| Stop Out | 20% |

---

## Arsitektur Sistem

```
+-------------------+        +-------------------+        +-------------------+
|   Browser (Anda)  | <----> |  Dashboard Web    | <----> |  MT5 Python Bridge|
|  React Dashboard  |  HTTP  |  (Next.js 16)     |  HTTP  |  (Windows 11)     |
|                   |  /WS   |  Port 3000        |        |  MetaTrader5 lib  |
+-------------------+        +-------------------+        +-------------------+
                                      |
                                      v
                             +-------------------+
                             |  AI Engine        |
                             |  z-ai-web-dev-sdk |
                             |  (LLM server-only)|
                             +-------------------+
                                      |
                                      v
                             +-------------------+
                             |  SQLite DB        |
                             |  (Prisma ORM)     |
                             |  Account, Trade,  |
                             |  Config, Log, ... |
                             +-------------------+
```

**Komponen utama:**
1. **Dashboard Web (Next.js 16)** — Control center berbasis React, dijalankan di sandbox/port 3000. Berkomunikasi dengan browser dan bridge Python.
2. **AI Engine** — Library `z-ai-web-dev-sdk` dipanggil server-side untuk analisa multi-faktor. Hasil disimpan di DB untuk self-learning.
3. **MT5 Python Bridge** — Aplikasi Python terpisah yang berjalan di mesin Windows 11 Anda, membaca kredensial tersimpan, dan memanggil library `MetaTrader5` untuk eksekusi order real.
4. **Database SQLite** — Menyimpan akun, kredensial MT5, trades, konfigurasi, log, analisa AI, dan hasil backtest.

Detail lengkap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Instalasi & Setup

### Prasyarat

- [Node.js](https://nodejs.org/) 18+ atau [Bun](https://bun.sh/) (direkomendasikan)
- Git
- Untuk trading real: Windows 11 dengan MetaTrader 5 terinstall + Python 3.14

### Langkah Instalasi

```bash
# 1. Clone repository
git clone https://github.com/teekar2312/frxai.git
cd frxai

# 2. Install dependencies
bun install
# atau: npm install

# 3. Salin & konfigurasi environment
cp .env.example .env
# Edit .env, sesuaikan DATABASE_URL

# 4. Inisialisasi database
bun run db:push

# 5. Jalankan dev server
bun run dev
```

Buka `http://localhost:3000` di browser. Dashboard akan muncul dengan tema dark trading terminal.

### Setup Trading Real (Windows 11)

Untuk trading dengan akun real FINEX Indonesia, Anda perlu menjalankan **MT5 Python Bridge** di mesin Windows Anda. Script bridge sudah tersedia di folder [`bridge/`](bridge/). Panduan lengkap: [docs/MT5-BRIDGE.md](docs/MT5-BRIDGE.md).

Ringkasan:
1. Install MetaTrader 5 desktop dari FINEX Indonesia
2. Install Python 3.14 + dependencies: `pip install -r bridge/requirements.txt`
3. Di dashboard: Settings → Broker/MT5 → isi nomor akun, password, server, path terminal
4. Jalankan bridge: `python bridge/mt5_bridge.py`
5. Bridge akan auto-launch terminal MT5 + login + sync account state

---

## Penggunaan

### Dashboard Operasional (Overview)
Monitor real-time: balance, equity, equity curve, market watch 4 pair, sesi trading aktif, posisi terbuka dengan P&L live, aktivitas terbaru.

### AI Analysis Center
1. Pilih pair aktif di Settings → Trading
2. Buka AI Analysis → klik **"Analisa Semua Pair"**
3. Tunggu ~15-20 detik (semua pair dianalisa paralel)
4. Lihat ringkasan semua pair, klik kartu untuk lihat detail heatmap 7 faktor
5. Klik "Eksekusi Sinyal" untuk generate signal trading

### Trading Terminal
1. Pastikan MT5 terhubung (Settings → Broker/MT5)
2. Pilih symbol, side (BUY/SELL), lot size, SL pips, TP pips
3. Aktifkan trailing stop jika perlu
4. Klik "Beli/Jual" untuk place order
5. Monitor posisi di tabel, klik "Tutup" untuk close

### Risk Management
Konfigurasi risk per trade, SL range, R:R ratio, max open positions, daily loss limit. Kalkulator lot size otomatis menghitung lot optimal berdasarkan balance & risk.

### Backtesting
Pilih symbol, timeframe, strategi, rentang tanggal, modal awal. Jalankan untuk melihat equity curve, win rate, profit factor, max drawdown.

---

## Struktur Proyek

```
frxai/
├── prisma/
│   └── schema.prisma              # Skema database (Account, Trade, Config, dll.)
├── src/
│   ├── app/
│   │   ├── api/                   # API routes (Next.js App Router)
│   │   │   ├── ai/                # AI analysis, signal, chat
│   │   │   ├── alerts/            # Price & email alerts
│   │   │   ├── backtest/          # Backtest run & list
│   │   │   ├── config/            # Account, trading, risk, keys config
│   │   │   ├── indicators/        # Indicator pool config
│   │   │   ├── logs/              # System & error logs
│   │   │   ├── market/            # Live market quotes
│   │   │   ├── mt5/               # MT5 connect/credentials/terminal
│   │   │   └── trade/             # Place/close/list trades
│   │   ├── globals.css            # Tema trading terminal
│   │   ├── layout.tsx             # Root layout + ThemeProvider
│   │   └── page.tsx               # Entry point (TradingShell)
│   ├── components/
│   │   ├── sections/              # 9 section components
│   │   │   ├── overview-section.tsx
│   │   │   ├── ai-section.tsx
│   │   │   ├── trading-section.tsx
│   │   │   ├── indicators-section.tsx
│   │   │   ├── risk-section.tsx
│   │   │   ├── backtest-section.tsx
│   │   │   ├── alerts-section.tsx
│   │   │   ├── logs-section.tsx
│   │   │   └── settings-section.tsx
│   │   ├── ui/                    # shadcn/ui components
│   │   ├── shared.tsx             # StatCard, Panel, Pill, dll.
│   │   ├── trading-shell.tsx      # Main layout (sidebar + topbar + footer)
│   │   └── theme-provider.tsx
│   └── lib/
│       ├── ai.ts                  # AI engine (z-ai-web-dev-sdk)
│       ├── constants.ts           # PAIRS, TIMEFRAMES, SESSIONS, INDICATOR_POOL
│       ├── db.ts                  # Prisma client
│       ├── market.ts              # Market data simulator + session detector
│       ├── server-config.ts       # Server-only config helpers
│       ├── store.ts               # Zustand store
│       ├── types.ts               # Shared TypeScript types
│       └── utils.ts               # cn() helper
├── docs/                          # Dokumentasi
├── bridge/                        # MT5 Python Bridge (Windows 11)
│   ├── mt5_bridge.py              # Script bridge runnable
│   ├── requirements.txt           # Python dependencies
│   └── README.md                  # Panduan bridge
├── examples/                      # WebSocket examples
├── public/                        # Static assets
├── .env.example                   # Environment template
├── .gitignore
├── Caddyfile                      # Gateway config
├── components.json                # shadcn/ui config
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs
└── tsconfig.json
```

---

## Dokumentasi Lengkap

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Arsitektur sistem & alur data
- [docs/API.md](docs/API.md) — Referensi semua endpoint API
- [docs/MT5-BRIDGE.md](docs/MT5-BRIDGE.md) — Setup MT5 Python Bridge di Windows
- [docs/INDICATORS.md](docs/INDICATORS.md) — 30 indikator & strategi scalping
- [docs/RISK-MANAGEMENT.md](docs/RISK-MANAGEMENT.md) — Aturan money management & kalkulator lot
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — Riwayat perubahan
- [CONTRIBUTING.md](CONTRIBUTING.md) — Panduan kontribusi

---

## Keamanan

- **Kredensial MT5** disimpan lokal di database SQLite (tidak dikirim ke server eksternal)
- **API keys** (Groq, OpenAI, Together, Tinyfish, Finnhub, Marketaux) di-mask di UI
- **`.env`** dan **`db/custom.db`** di-gitignore (tidak pernah di-commit)
- AI engine (`z-ai-web-dev-sdk`) hanya berjalan server-side
- Untuk produksi: gunakan HTTPS, batasi akses dashboard, backup database berkala

**Penting:** Jangan pernah commit file `.env` atau `db/custom.db`. Selalu gunakan `.env.example` sebagai template.

---

## Lisensi

MIT License — bebas digunakan, dimodifikasi, dan didistribusikan. Lihat file [LICENSE](LICENSE).

---

## Penafian

Software ini disediakan "apa adanya" tanpa jaminan. Trading forex berisiko tinggi dan dapat mengakibatkan kerugian finansial. Pengguna bertanggung jawab penuh atas keputusan trading. Selalu:
- Mulai dengan akun demo
- Gunakan risk management ketat (0.5-1% per trade)
- Backtest strategi sebelum live trading
- Jangan trading dengan uang yang tidak siap Anda hilangkan
