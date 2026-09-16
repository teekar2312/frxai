# FINEX AI Trading System

Sistem trading forex **full-stack** dengan analisa AI multi-provider, manajemen risiko ketat, dan eksekusi nyata via MetaTrader 5 — dirancang untuk akun **FINEX Indonesia** (leverage 1:500).

> ⚠️ **Peringatan risiko**: Trading forex dengan dana riil berisiko kehilangan modal. Sistem ini menyediakan batas risiko otomatis, namun **tidak menjamin profit**. Gunakan mode DEMO untuk pembelajaran dan uji strategi terlebih dahulu.

---

## ✨ Fitur Utama

| Area | Detail |
|---|---|
| **Trading** | Market watch 18 pair (major + cross + logam XAUUSD/XAGUSD), order BUY/SELL market, SL/TP, trailing stop, close/close-all, mode lot manual atau **risk-based** (0,5–1% risiko per trade otomatis) |
| **Analisa AI** | 8 provider LLM (ZAI default; Groq, TinyFish, OpenAI, Google, OpenRouter, TokenPlus, local), batch analysis semua pair aktif sekali klik, sinyal STRONG_BUY…STRONG_SELL dengan entry/SL/TP/RR + penalaran lengkap |
| **Indikator teknikal** | 30 indikator (EMA, RSI, MACD, ATR, Bollinger, SuperTrend, Stochastic, VWAP, OBV, CCI, Williams %R, Momentum, PSAR, SMA, Donchian, MFI, ROC, StdDev, AD, TickVol, dst.) |
| **Fundamental** | 13 kategori konteks (suku bunga, inflasi, pertumbuhan, geopolitik, komoditas, dst.) dipilih adaptif per pair oleh AI |
| **Berita & kalender** | Finnhub + Marketaux (opsional API key), auto pair-tagging + sentimen + dampak, kalender ekonomi 8 mata uang |
| **Manajemen risiko** | Risk 0,5–1%/trade, batas risiko harian 2,5% (anti margin-call), target harian 2%, maks 2–3 posisi, stop-out enforcement, avoid-news gate |
| **Self-learning** | Model pembobotan indikator yang belajar dari hasil trade (source MANUAL/AI/ANALYSIS), bobot diperbarui otomatis per menang/kalah |
| **Backtest** | Engine backtest per pair/timeframe (9 TF: M1–MN), metrik lengkap (win rate, profit factor, max DD, expectancy, Sharpe, kurva ekuitas) |
| **Alerts & notifikasi** | Price alert ABOVE/BELOW per pair, notifikasi email 6 event (open/close/alert/error/daily report), audit log AUTH |
| **Mode engine** | **DEMO** (simulator realistis di server — spread, commission, slippage, volatilitas sesi) & **LIVE** (proxy ke Python engine + MT5 di PC Anda) |
| **UI/UX** | Dark/light theme, 3 mode kepadatan (Compact/Dense/Minimal), responsif mobile-first, angka mono tabular, aksen emerald |

## 🧱 Tech Stack

| Layer | Teknologi |
|---|---|
| Dashboard | Next.js 16 (App Router, standalone output), React 19, TypeScript 5 (strict) |
| UI | Tailwind CSS 4, shadcn/ui (New York), Lucide icons, recharts, sonner, framer-motion |
| State | zustand (client), polling 2s (server state) |
| Backend | Next.js Route Handlers (24 route), proxy gate auth + rate limit |
| Database | Prisma ORM + SQLite (WAL mode), 10 model |
| Auth | JWT session (jose, HS256) cookie HttpOnly + scrypt password hash |
| AI | z-ai-web-dev-sdk (ZAI LLM) + 7 provider alternatif |
| Engine LIVE | Python 3.11+ (diuji hingga 3.14), FastAPI, MetaTrader5, pandas, scikit-learn |

## 🚀 Quick Start (Development)

```bash
# 1. Install dependency
bun install

# 2. Siapkan environment (lihat .env.example)
cp .env.example .env
#    - Wajib: SESSION_SECRET (openssl rand -base64 48)
#    - Login dev: ADMIN_USERNAME + ADMIN_PASSWORD

# 3. Siapkan database
bunx prisma db push

# 4. Jalankan
bun run dev          # → http://localhost:3000
```

Login default first-run: **admin / finex-admin-2025** (ganti via `bun run hash-password <pw>` → `ADMIN_PASSWORD_HASH`).

> Simulator DEMO menyediakan data pasar sintetis-realistik — **tanpa API key apa pun** sistem tetap berfungsi penuh (berita simulasi, analisa via heuristik lokal).

### Mode LIVE (MetaTrader 5)

1. Download engine dari tab **Engine Setup** dashboard (ZIP `python-engine/`)
2. Di PC Windows: `pip install -r requirements.txt`, isi `config.yaml` (akun FINEX + `api_key`)
3. Jalankan `python main.py` → FastAPI di `http://localhost:8000`
4. Di dashboard Settings: mode **LIVE** + URL engine → polling harga/akun/posisi nyata

## 📁 Struktur Proyek

```
├── src/
│   ├── app/
│   │   ├── page.tsx              # Route UI tunggal (login gate → dashboard)
│   │   ├── proxy.ts              # Gerbang API: auth + rate limit
│   │   └── api/                  # 24 route handler (REST)
│   ├── components/
│   │   ├── auth/                 # Login screen
│   │   ├── finex-app.tsx         # Shell dashboard
│   │   ├── layout/               # Header, sidebar, footer
│   │   ├── panels/               # 9 panel: overview, trading, analysis,
│   │   │                         #   news, backtest, alerts, logs, settings, setup
│   │   ├── shared/               # Primitives (badge sinyal, live dot, dst.)
│   │   └── ui/                   # shadcn/ui primitives
│   ├── lib/
│   │   ├── auth-core.ts          # JWT session (edge-safe)
│   │   ├── auth-node.ts          # Scrypt verify + brute-force guard
│   │   ├── constants.ts          # 18 pair, 9 TF, 30 indikator, 8 provider
│   │   ├── engine/simulator.ts   # Simulator DEMO + risk engine
│   │   ├── db.ts                 # Prisma client + WAL
│   │   └── types.ts              # Kontrak tipe lintas stack
│   └── instrumentation.ts        # Boot: aktifkan WAL
├── prisma/schema.prisma          # 10 model DB
├── python-engine/                # Engine LIVE (Windows + MT5)
│   ├── main.py                   # FastAPI + 5 thread daemon
│   └── app/                      # mt5_client, strategy, indicators, news, dst.
├── scripts/                      # hash-password, backup-db
├── Dockerfile & docker-compose.yml
└── PRODUCTION.md                 # Runbook operasional
```

## 📚 Dokumentasi

| Dokumen | Isi |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Arsitektur sistem, alur data, skema DB, keputusan desain |
| [API.md](./API.md) | Referensi lengkap seluruh endpoint dashboard + engine |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Panduan deploy VPS / Docker / Windows |
| [SECURITY.md](./SECURITY.md) | Model ancaman, lapisan keamanan, batasan diketahui |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Konvensi kode, alur kerja, protokol worklog |
| [CHANGELOG.md](./CHANGELOG.md) | Riwayat versi |
| [PRODUCTION.md](./PRODUCTION.md) | Runbook ops: backup, monitoring, troubleshooting |
| [python-engine/README.md](./python-engine/README.md) | Panduan engine LIVE (Windows/MT5) |

## 🔐 Keamanan (Ringkas)

- Autentikasi wajib: session JWT 7 hari, brute-force lockout 5×15 menit, audit log
- Seluruh `/api/*` dilindungi gerbang + rate limit (240 GET / 60 write per menit per IP)
- Engine LIVE: header `X-Engine-Key` + CORS origin ketat — **jangan pernah port-forward tanpa tunnel**
- Detail lengkap: [SECURITY.md](./SECURITY.md)

## 📄 Lisensi

Proprietary — hak cipta pemilik repository. Tidak untuk distribusi atau penggunaan komersial tanpa izin tertulis.
