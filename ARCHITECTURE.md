# Arsitektur — FINEX AI Trading System

Dokumen ini menjelaskan struktur sistem, alur data, dan rasional keputusan desain. Untuk referensi endpoint lihat [API.md](./API.md); untuk keamanan [SECURITY.md](./SECURITY.md).

---

## 1. Gambaran Umum

```
                        ┌──────────────────────────────────────────────┐
                        │              BROWSER (user)                  │
                        │  Next.js App Router — route tunggal "/"       │
                        │  9 panel · zustand · polling 2 detik         │
                        └───────────────┬──────────────────────────────┘
                                        │ HTTPS (cookie session JWT)
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                        NEXT.JS 16 SERVER (port 3000)                          │
│                                                                               │
│  src/proxy.ts (gerbang API)                                                   │
│    ├─ Rate limit per IP (GET 240/mnt · write 60/mnt)                          │
│    └─ Verifikasi session → 401 bila invalid                                   │
│         │                                                                     │
│         ▼                                                                     │
│  24 Route Handler (/src/app/api/**)                                           │
│    ├─ Publik: /api/auth/* · /api/health                                       │
│    └─ Terlindungi: engine, orders, analysis, news, alerts, backtest, …        │
│         │                                                                     │
│         ▼                                                                     │
│  ┌────────────────────────────┐      ┌──────────────────────────────────┐    │
│  │ MODE DEMO (default)        │      │ MODE LIVE                        │    │
│  │ Simulator (server ts)      │      │ Proxy → Python engine             │    │
│  │ · harga sintetis-realistis │      │ (http://engineUrl, timeout 2.5s)  │    │
│  │ · risk & margin engine     │      │ header X-Engine-Key               │    │
│  │ · self-learning model      │      └──────────────┬───────────────────┘    │
│  │ · email simulasi           │                     │                       │
│  └────────────┬───────────────┘                     │                       │
└───────────────┼──────────────────────────────────────┼───────────────────────┘
                ▼                                      ▼
        ┌─────────────────┐              ┌─────────────────────────────┐
        │ SQLite + WAL    │              │ PYTHON ENGINE (PC Windows)   │
        │ Prisma ORM      │              │ FastAPI :8000 + 5 thread     │
        │ 10 model        │              │ MetaTrader5 → FINEX broker   │
        └─────────────────┘              │ akun real leverage 1:500     │
                                         └─────────────────────────────┘
```

**Prinsip inti**: satu dashboard, dua mode engine. Seluruh logika UI, analisa, backtest, dan berita berjalan di server Next.js; engine Python hanya menangani interaksi MT5 (harga, akun, order, posisi). Kontrak antar keduanya **satu payload** `GET /api/v1/poll` sehingga panel dashboard identik di kedua mode.

## 2. Layer Dashboard

### 2.1 Frontend (client)

- **Route tunggal** `src/app/page.tsx` — *server component* yang menjadi gerbang: tanpa session valid → `<LoginScreen/>`, dengan session → `<FinexApp username/>`.
- **9 panel** (`src/components/panels/`): Overview, Trading, AI Analysis, News, Backtest, Alerts, Logs, Settings, Engine Setup. Hanya panel aktif yang di-mount (unmount membersihkan timer).
- **State**: `zustand` (`src/lib/store.ts`) untuk tab aktif, kepadatan UI, refresh counter. Data server via hook `usePolling` (GET berkala, backoff saat tab blur).
- **Kepadatan UI**: atribut `data-density` di `<html>` (compact/dense/minimal) + skala rem via CSS — diset pre-paint oleh inline script agar tanpa flash.
- **Real-time**: polling REST 2 detik (bukan WebSocket) — pilihan sadar untuk kesederhanaan deploy; beban dibatasi cache & payload ringkas.

### 2.2 Gerbang API (`src/proxy.ts`)

Konvensi Next.js 16 (penerus middleware). Berjalan di Edge-ish runtime sebelum semua route handler:

1. **Rate limit** in-memory per IP (window 60s, bucket dibersihkan saat >5000 entri).
2. **Autentikasi**: verifikasi JWT `finex_session` (HS256, `jose`) → 401 JSON bila invalid.
3. Publik hanya `/api/auth/*` dan `/api/health` (via matcher regex negatif).

### 2.3 Route Handler (24 route)

Pola konsisten: `NextResponse.json`, validasi input manual/zod dengan pesan error Indonesia, `force-dynamic`, dan seluruh akses data melalui **simulator/service** (bukan query Prisma langsung dari panel).

### 2.4 Simulator DEMO (`src/lib/engine/simulator.ts`)

Jantung mode demo — singleton per proses server:

- **Pasar**: random-walk dengan volatilitas per sesi (Sydney→NY), spread + commission + swap per pair, 18 pair + XAUUSD/XAGUSD.
- **Risk engine**: lot risk-based = (equity × risk%) / (SL pips × nilai pip); margin quote-currency dikonversi ke USD via helper `quoteToUsd` (harga live, fallback config) — koreksi penting untuk cross JPY/CHF.
- **Guard**: daily loss limit (stop-out paksa), max positions, margin level enforcement, daily roll + laporan email simulasi.
- **Self-learning**: `ModelStat` per indikator — menang → weight naik, kalah → turun (source MANUAL/AI/ANALYSIS).
- **Persistensi**: seluruh state (posisi, akun, settings, log) di SQLite via Prisma.

## 3. Python Engine (LIVE)

Folder `python-engine/` — aplikasi FastAPI terpisah yang berjalan di PC Windows user berdampingan dengan terminal MT5:

| Thread | Interval | Tugas |
|---|---|---|
| TICK | ~1s | Harga pair aktif, akun, daily roll, status |
| STRATEGY | ~15s | Siklus AI: gate harian → sesi → news → kandidat → TF → indikator → skor LLM+ML → lot → eksekusi |
| POSITIONS | ~1s | Refresh posisi, trailing stop, deteksi penutupan (SL/TP/manual), stop-out watch |
| NEWS | 5 mnt | Finnhub + Marketaux + sentimen + kalender |
| ALERTS | ~2s | Pemicuan alert harga + email |

Keamanan: middleware `X-Engine-Key` (hmac compare) untuk seluruh `/api/*`, CORS `allowed_origins` eksplisit, `/health` publik. Handler `/api/v1/poll` **hanya membaca cache state** (tidak pernah memanggil MT5) sehingga selalu <10ms — sesuai timeout proxy 2,5s.

## 4. Alur Data Kunci

### 4.1 Polling loop (2s)
```
Header/panel → GET /api/engine → proxy gate → mode?
  ├─ DEMO → sim.tick() (advance harga, cek SL/TP/trailing/alerts/roll) → payload penuh
  └─ LIVE → fetch engineUrl/api/v1/poll (X-Engine-Key, 2.5s timeout)
        ├─ 200 → payload engine (dipakai apa adanya)
        └─ gagal → fallback data demo + status.connected=false
```

### 4.2 Analisa AI (POST /api/analysis)
```
Input {pair, timeframe} → kumpul konteks:
  indikator (30) · fundamental (13 kategori) · sentimen berita pair-tagged
  → cache 30s per pair+tf
  → provider LLM (ZAI default) → struktur: signal/confidence/entry/SL/TP/reasoning
  → fallback heuristik lokal bila provider gagal (voting indikator berbobot ML)
  → persist AnalysisRecord
```
Batch mode: panel memanggil berurutan per pair aktif dengan progress di UI.

### 4.3 Siklus order
```
POST /api/orders {action:open|close|closeAll|modify}
  → validasi (pair/side/volume|riskBased)
  → margin cek (quoteToUsd) + guard (max pos, daily limit, margin level)
  → DEMO: simulator fill (spread+slippage) │ LIVE: proxy POST /api/v1/orders
  → audit LogEntry + (opsional) email + learning source ANALYSIS/AI/MANUAL
```

### 4.4 Self-learning loop
```
posisi tertutup (TP/SL/manual) → outcome menang/kalah
  → tiap indikator yang "setuju" saat open (signalIndicators CSV):
      menang → wins+1, weight↑ · kalah → losses+1, weight↓
  → bobot dipakai analisa berikutnya (voting berbobot)
```

## 5. Skema Database (Prisma + SQLite WAL)

| Model | Peran | Catatan |
|---|---|---|
| `Settings` | Konfigurasi tunggal (`id=main`) | mode, pairs, TF, indikator, risiko, engine, email |
| `Account` | State akun (balance/equity/margin) | daily roll `dailyStart` |
| `Position` | Posisi & riwayat trade | index `[status,openedAt]`, `[pair,status]`; `signalIndicators` untuk learning |
| `LogEntry` | Audit + log sistem | kategori: TRADING/ENGINE/AI/RISK/NEWS/ALERT/SYSTEM/EMAIL/**AUTH** |
| `PriceAlert` | Alert ABOVE/BELOW | index `[status]` |
| `Backtest` | Hasil backtest | equityCurve + trades JSON |
| `NewsItem` | Berita (FINNHUB/MARKETAUX/WEB/SIM) | auto pair-tag + sentimen |
| `AnalysisRecord` | Riwayat analisa AI | index `[pair,createdAt]` |
| `ModelStat` | Bobot self-learning per indikator | `@unique(indicator)` |

WAL mode diaktifkan saat boot (`src/instrumentation.ts`) — pembaca (polling 2s) tidak pernah diblokir penulis.

## 6. Keputusan Desain

| Keputusan | Alasan |
|---|---|
| Route UI tunggal | Dashboard trading = SPA; menghindari kompleksitas routing & memindahkan state antar halaman |
| Polling, bukan WebSocket | Deploy sederhana (VPS/Docker statis), cukup untuk refresh 2s; beban rendah berkat payload ringkas |
| Simulator sebagai sumber kebenaran DEMO | Paritas fitur penuh demo/live — semua panel & API identik, hanya lapisan eksekusi berbeda |
| Kontrak poll tunggal | Engine Python hanya perlu implementasi satu endpoint inti; analisa/backtest/berita tetap di dashboard (hemat resource PC user) |
| SQLite + WAL | Single-writer (satu server), zero-ops, backup file tunggal; WAL → reader non-blocking |
| Rate limit & lockout in-memory | Instance tunggal & state kecil; tanpa dependensi Redis (lihat batasan di SECURITY.md) |
| Password scrypt + JWT session | Tanpa dependensi DB auth; rotasi secret mem-invalidasi semua session |
| `ignoreBuildErrors: false` | Produksi gagal cepat bila TS error — mencegah regresi senyap |

## 7. Kontrak Tipe Lintas Stack

`src/lib/types.ts` adalah sumber kebenaran TypeScript (Pair union, Timeframe, EnginePollResponse, dll.). Padanan Python: `python-engine/app/config.py` (`KNOWN_PAIRS`, `KNOWN_TIMEFRAMES`, dst.). Keduanya **wajib sinkron** — 18 pair × 2 stack diverifikasi pada audit Task 14. Bila menambah pair/TF, ubah keduanya + `getPairConfig` (pip size, digits, contract size).
