# FINEX AI Trading Engine — Panduan Lengkap (Bahasa Indonesia)

Engine trading **LIVE** berbasis Python + MetaTrader 5 untuk **akun real FINEX Indonesia**.
Engine ini berjalan di PC Windows Anda, membaca harga dari terminal MT5, menjalankan
analisa (30 indikator teknikal + model ML self-learning + AI provider LLM), mengeksekusi
order, mengelola risiko (SL/TP, trailing stop, daily limit anti-MC, stop-out watch),
lalu menyajikan semuanya ke dashboard Next.js lewat API FastAPI di
`http://localhost:8000`.

> ## ⚠️ PERINGATAN RISIKO — BACA DULU SEBELUM MENJALANKAN ⚠️
>
> **Ini adalah akun trading REAL. Uang Anda berisiko hilang.**
>
> - FINEX menerapkan **Margin Call 50%** dan **Stop Out 20%** — saat margin level
>   jatuh, posisi Anda bisa ditutup **paksa oleh broker**.
> - Trading forex/gold dengan leverage 1:500 **sangat berisiko tinggi**. Kerugian
>   bisa melebihi ekspektasi Anda bila pasar bergerak cepat (gap, news, slippage).
> - Sebelum mode AI diaktifkan:
>   1. **Backtest dulu** strategi/indikator di tab *Backtest* dashboard (mode DEMO).
>   2. Gunakan **risk per trade 0.5%** (minimum) dan lot terkecil (0.01) di awal.
>   3. Aktifkan **daily limit 2%** (anti margin call) dan biarkan aktif.
>   4. Pantau engine di jam-jam pertama — jangan ditinggal trading.
> - Gunakan flag `--dry-run` untuk mencoba engine **tanpa mengirim order ke broker**.
> - Developer tidak bertanggung jawab atas kerugian finansial apa pun.

---

## Daftar Isi

1. [Prasyarat](#1-prasyarat)
2. [Struktur Folder](#2-struktur-folder)
3. [Langkah Setup](#3-langkah-setup)
4. [Menjalankan Engine](#4-menjalankan-engine)
5. [Perilaku Auto-Launch MetaTrader 5](#5-perilaku-auto-launch-metatrader-5)
6. [Konfigurasi AI Provider](#6-konfigurasi-ai-provider)
7. [Konfigurasi Berita (News)](#7-konfigurasi-berita-news)
8. [Notifikasi Email (SMTP)](#8-notifikasi-email-smtp)
9. [Menghubungkan ke Dashboard](#9-menghubungkan-ke-dashboard)
10. [API Engine](#10-api-engine)
11. [Arsitektur Engine](#11-arsitektur-engine)
12. [Troubleshooting](#12-troubleshooting)
13. [Catatan Keamanan & Risiko](#13-catatan-keamanan--risiko)

---

## 1. Prasyarat

| Kebutuhan | Keterangan |
|---|---|
| **Windows 10/11 (64-bit)** | Engine MT5 hanya berjalan di Windows. |
| **Python 3.14 (64-bit)** | Unduh dari <https://www.python.org/downloads/> → pilih *Windows installer (64-bit)*. Saat instalasi **centang "Add python.exe to PATH"**. |
| **MetaTrader 5 terminal** | Terminal dari FINEX Indonesia (atau MetaQuotes). Sudah terinstall dan **sudah login akun real** minimal satu kali. |
| **Akun real FINEX Indonesia** | Nomor akun, password, dan nama server (contoh: `FINEX-Live`). |
| **Koneksi internet** | Untuk harga MT5, berita, dan AI provider. |
| **RAM ± 1–2 GB kosong** | Python + pandas/scikit-learn + terminal MT5. |

> Catatan: paket pip `MetaTrader5` resmi hanya menyediakan wheel untuk Windows
> (dan Python 64-bit). Di Linux/Mac engine akan tetap hidup tetapi tanpa data MT5.

---

## 2. Struktur Folder

```
python-engine/
├── main.py                ← ENTRY POINT — jalankan: python main.py
├── README.md              ← panduan ini
├── requirements.txt       ← dependensi pip
├── config.example.yaml    ← contoh konfigurasi (salin → config.yaml)
├── .env.example           ← contoh kredensial (salin → .env)
├── app/
│   ├── config.py          ← konfigurasi (YAML + .env, validasi & clamp)
│   ├── logger.py          ← logger rotating (logs/engine.log)
│   ├── state.py           ← state bersama thread-safe (singleton)
│   ├── mt5_client.py      ← jembatan MetaTrader 5 + auto-launch terminal
│   ├── sessions.py        ← sesi trading forex (Sydney/Tokyo/London/NY, UTC)
│   ├── indicators.py      ← 30 indikator teknikal (pandas/numpy, tanpa TA-Lib)
│   ├── ml_model.py        ← model ML self-learning (SGD online + bobot indikator)
│   ├── ai_providers.py    ← 8 penyedia AI (httpx async, tanpa SDK)
│   ├── fundamental.py     ← prompt analisa fundamental + parser JSON AI
│   ├── news.py            ← berita Finnhub/MarketAux + kalender ekonomi
│   ├── strategy.py        ← mesin keputusan (teknikal + ML + AI, blend skor)
│   ├── alerts.py          ← alert harga (persist JSON, thread-safe)
│   ├── backtest.py        ← backtester walk-forward (library `run_backtest`)
│   └── emailer.py         ← notifikasi email SMTP (tidak pernah raise)
├── config.yaml            ← (dibuat Anda) konfigurasi aktif
├── .env                   ← (dibuat Anda) kredensial — JANGAN DI-COMMIT!
├── logs/engine.log        ← (otomatis) log engine, rotasi 5 MB × 5
├── data/alerts.json       ← (otomatis) persistensi alert harga
└── models/                ← (otomatis) model.joblib + weights.json (ML)
```

---

## 3. Langkah Setup

### 3.1 Install Python 3.14

1. Unduh **Python 3.14.x — Windows 64-bit installer** dari python.org.
2. Jalankan installer → **centang "Add python.exe to PATH"** → *Install Now*.
3. Verifikasi di **Command Prompt / PowerShell**:

   ```bat
   python --version
   :: harusnya: Python 3.14.x
   ```

### 3.2 Letakkan folder engine

Ekstrak / letakkan folder `python-engine` di lokasi tetap, misal:

```
C:\finex\python-engine
```

Buka terminal di folder tersebut:

```bat
cd C:\finex\python-engine
```

### 3.3 Install dependensi

```bat
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Ini memasang: `MetaTrader5`, `pandas`, `numpy`, `scikit-learn`, `fastapi`,
`uvicorn`, `httpx`, `PyYAML`, `python-dotenv`, `joblib`.

### 3.4 Buat `config.yaml`

```bat
copy config.example.yaml config.yaml
```

Lalu edit `config.yaml` sesuai selera (mode manual/ai, pair, sesi, timeframe,
indikator, parameter risiko, port API). Nilai di luar rentang aman otomatis
di-clamp dan dicatat sebagai peringatan di log. **Kredensial jangan ditulis di
sini — pakai file `.env`.**

### 3.5 Buat `.env` (kredensial)

```bat
copy .env.example .env
```

Edit `.env` dengan Notepad. **Contoh `.env` lengkap:**

```ini
# === MetaTrader 5 / akun real FINEX Indonesia ===
MT5_LOGIN=12345678
MT5_PASSWORD=passwordAkunAnda
MT5_SERVER=FINEX-Live
# Path terminal (opsional — kalau kosong, engine mencari otomatis):
MT5_PATH=C:\Program Files\MetaTrader 5\terminal64.exe
# MT5_PORTABLE=true          # hanya jika terminal dipasang mode portable

# === Berita (gratis, sangat disarankan) ===
FINNHUB_API_KEY=xxxxxxxxxxxxxxxxxxxx
MARKETAUX_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx

# === AI Provider — isi SESUAI provider yang dipakai (lihat bagian 6) ===
ZAI_API_KEY=
GROQ_API_KEY=
TINYFISH_API_KEY=
TINYFISH_BASE_URL=
OPENAI_API_KEY=
GOOGLE_API_KEY=
OPENROUTER_API_KEY=
TOKENPLUS_API_KEY=
TOKENPLUS_BASE_URL=
OLLAMA_BASE_URL=http://localhost:11434

# === Email notifikasi (opsional, lihat bagian 8) ===
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=namaanda@gmail.com
SMTP_PASSWORD=app-password-16-karakter
EMAIL_TO=namaanda@gmail.com

# === Lain-lain (opsional) ===
# FINEX_LOG_LEVEL=INFO       # DEBUG|INFO|WARNING|ERROR
```

> **KEAMANAN:** file `.env` berisi password akun trading Anda.
> - Jangan pernah di-commit ke Git / dibagikan.
> - Pastikan `.env` ada di `.gitignore` bila folder ini masuk repositori.
> - File `config.yaml` yang ditulis ulang oleh engine juga **tidak pernah
>   menyimpan kredensial** (login/password/API key otomatis dibuang).

---

## 4. Menjalankan Engine

```bat
cd C:\finex\python-engine
python main.py
```

Banner startup akan muncul:

```
==================================================================
  FINEX AI TRADING ENGINE v1.0.0  —  LIVE / FINEX Indonesia
==================================================================
  Python      : 3.14.7  (win32)
  Paket MT5   : tersedia
  Konfigurasi : C:\finex\python-engine\config.yaml (0 peringatan)
  Mode trading: manual   |  Provider AI: zai (terkonfigurasi: zai, local)
  Pair aktif  : EURUSD, USDJPY, GBPUSD, USDCHF, USDCAD, AUDUSD, NZDUSD,
                EURJPY, EURGBP, EURCHF, EURAUD, GBPJPY, GBPCHF, AUDJPY,
                CADJPY, CHFJPY, XAUUSD, XAGUSD  (18 pair)
  API engine  : http://127.0.0.1:8000  (docs: /docs, poll: /api/v1/poll)
  File log    : C:\finex\python-engine\logs\engine.log
==================================================================
```

Opsi CLI tambahan:

| Perintah | Fungsi |
|---|---|
| `python main.py` | Jalankan normal. |
| `python main.py --dry-run` | **Mode simulasi** — semua keputusan AI & order manual dijalankan tetapi TIDAK dikirim ke broker (aman untuk belajar). |
| `python main.py --backtest EURUSD H1` | **Backtest offline** — ambil candle dari MT5, jalankan walk-forward backtest, print ringkasan, lalu keluar (tanpa start server). |
| `python main.py --backtest GBPJPY M15 --bars 2000` | Backtest dengan jumlah bar kustom (300–5000). |
| `python main.py --config D:\config.yaml` | Pakai file konfigurasi kustom. |
| `python main.py --version` | Tampilkan versi engine. |

Apa yang terjadi setelah start:

1. Engine mencoba **menyambung + me-launch terminal MT5** (lihat bagian 5).
2. Lima thread latar belakang jalan: harga (1s), strategi AI (15s), manajemen
   posisi (1s), berita (5 menit), alert (2s).
3. Server API FastAPI aktif di `http://127.0.0.1:8000` — dashboard tinggal
   diarahkan ke sini (bagian 9).
4. Log tertulis ke `logs/engine.log` (rotasi otomatis 5 MB × 5 file).
5. Tekan **Ctrl+C** untuk berhenti — koneksi MT5 ditutup dengan rapi
   (posisi terbuka **tidak** ditutup otomatis; SL/TP tetap aktif di server broker).

> Engine sengaja dirancang **tidak pernah mati** karena satu error: kegagalan
> MT5/berita/email hanya dicatat ke log lalu dicoba ulang. Status
> `connected=false` di dashboard menandakan MT5 sedang terputus — engine tetap
> mencoba reconnect tiap 15 detik.

---

## 5. Perilaku Auto-Launch MetaTrader 5

Saat startup (dan setiap reconnect), engine mencari & menjalankan
`terminal64.exe` dengan urutan:

1. **`mt5.initialize()` langsung** — kalau terminal sudah berjalan dan akun
   sudah login, langsung sukses tanpa membuka apa pun.
2. **Path dari konfigurasi** — `MT5_PATH` di `.env` atau `mt5.path` di
   `config.yaml` (bisa path `terminal64.exe` langsung atau foldernya).
3. **Folder instalasi umum**:
   - `C:\Program Files\MetaTrader 5\terminal64.exe`
   - `C:\Program Files (x86)\MetaTrader 5\terminal64.exe`
   - `C:\Program Files\MetaTrader 5*\terminal64.exe` (broker-custom build)
4. **Registry Windows** — `HKLM/HKCU\SOFTWARE\MetaQuotes\Terminal` dan entri
   *Uninstall* aplikasi (DisplayName mengandung "MetaTrader"/"MetaQuotes").
5. Terminal dijalankan via `subprocess.Popen` (dengan `/portable` bila
   `MT5_PORTABLE=true`), lalu engine polling koneksi tiap 3 detik sampai
   `mt5.timeout_seconds` (default 60s).

Jika akun lain sedang aktif di terminal, engine otomatis **login ulang** ke
`MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` Anda.

**Tips penting:**

- Pastikan tombol **"Algo Trading"** di terminal MT5 dalam keadaan **ON**
  (hijau) — tanpa itu order akan ditolak.
- Pastikan pair yang Anda perdagangkan (mis. EURUSD, USDJPY, GBPUSD, XAUUSD)
  muncul di Market Watch
  (engine memilih otomatis via `symbol_select`, tapi cek nama symbol di broker
  Anda — kadang berprefiks, mis. `EURUSD.r` — jika begitu hubungi developer
  untuk penyesuaian).
- Biarkan terminal MT5 tetap terbuka selama engine berjalan (boleh minimize).

---

## 6. Konfigurasi AI Provider

Provider dipilih di `config.yaml` → `ai.provider` (atau diubah runtime lewat
`POST /api/v1/settings` / dashboard). Kunci API **selalu** dari file `.env`.

| id | Nama | Env var kunci | Model default | Cara dapat API key | Biaya |
|---|---|---|---|---|---|
| `zai` *(default)* | Z.AI (BigModel) | `ZAI_API_KEY` | `glm-4.6` | Daftar di <https://z.ai> → platform BigModel → API Keys | Ada free tier terbatas |
| `groq` | Groq AI | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | Gratis di <https://console.groq.com/keys> | Free tier dermawan |
| `tinyfish` | Tinyfish AI | `TINYFISH_API_KEY` (+ `TINYFISH_BASE_URL` bila endpoint kustom) | `tinyfish-1` | Dashboard Tinyfish <https://tinyfish.ai> | Sesuai ketentuan layanan |
| `openai` | OpenAI | `OPENAI_API_KEY` | `gpt-4o` | <https://platform.openai.com/api-keys> | Pay-as-you-go |
| `google` | Google AI Studio | `GOOGLE_API_KEY` | `gemini-2.0-flash` | Gratis di <https://aistudio.google.com/app/apikey> | Free tier cukup besar |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` | `openrouter/auto` | <https://openrouter.ai/keys> | Ada model gratis |
| `tokenplus` | Tokenplus AI | `TOKENPLUS_API_KEY` (+ `TOKENPLUS_BASE_URL` bila kustom) | `tokenplus-pro` | Dashboard Tokenplus | Sesuai ketentuan layanan |
| `local` | Ollama (lokal) | `OLLAMA_BASE_URL` (default `http://localhost:11434`) | `qwen2.5:14b` | Install <https://ollama.com> → `ollama serve` → `ollama pull qwen2.5:14b` | Gratis 100% lokal |

Override model per provider: env `{PROVIDER}_MODEL`, mis.
`GROQ_API_KEY=...` + `GROQ_MODEL=llama-3.1-8b-instant`, atau
`ai.model` di `config.yaml`.

**Bagaimana AI dipakai engine:**

- Mode AI mencetak sinyal tiap ± 15 detik. Skor akhir = **50% analisa lokal**
  (voting 30 indikator berbobot + prediksi ML) **+ 50% jawaban LLM**
  (analisa fundamental: bank sentral, NFP/CPI/PPI/GDP/PMI, geopolitik,
  komoditas, sentimen, breaking news).
- Bila provider gagal (kunci kosong, internet mati, quota habis) engine
  **otomatis fallback** ke analisa lokal — trading tetap jalan, hanya
  berlabel `live=false`.
- Rekomendasi pemula: `groq` atau `google` (gratis dan cepat).

---

## 7. Konfigurasi Berita (News)

Engine menggabungkan dua sumber (di `.env`):

| Sumber | Env var | Cara daftar (free tier) |
|---|---|---|
| **Finnhub** | `FINNHUB_API_KEY` | Daftar gratis di <https://finnhub.io/register> → menu *API Keys* → salin. Free tier: ± 60 panggilan/menit, kategori `forex`. |
| **MarketAux** | `MARKETAUX_API_KEY` | Daftar gratis di <https://www.marketaux.com/register> → dashboard → *API token*. Free tier: ± 100 panggilan/hari, lengkap dengan skor sentimen per entitas. |

Perilaku:

- Berita diambil tiap **5 menit**, digabung + dedupe (maks 60 item), lalu
  **diklasifikasi sentimen (-1..1) oleh AI provider** (fallback heuristik kata
  kunci bila AI tidak tersedia).
- **Kalender ekonomi** dibangkitkan deterministik oleh engine (NFP, CPI, PPI,
  GDP, Retail Sales, ISM PMI, FOMC, ECB, BoJ, BoE, RBA — 3 hari ke depan)
  sehingga selalu tersedia tanpa API key.
- **Gate anti-news**: bila `risk.avoid_news: true` (disarankan), siklus AI
  **berhenti** ± `news.avoid_minutes` (default 15 menit) di sekitar event
  kalender HIGH impact, dan sesaat setelah berita BREAKING/sentimen kuat.

---

## 8. Notifikasi Email (SMTP)

Engine mengirim email untuk event: `trade_open`, `trade_close`, `alert`,
`error`, `daily_report`, `daily_limit` (atur di `config.yaml` → `email.events`).

Contoh pakai **Gmail** (paling umum):

1. Aktifkan **2-Step Verification** di akun Google Anda.
2. Buat **App Password**: <https://myaccount.google.com/apppasswords>
   (pilih *Mail* → generate → dapat 16 karakter).
3. Isi `.env`:

   ```ini
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=namaanda@gmail.com
   SMTP_PASSWORD=abcd efgh ijkl mnop     # 16 karakter app password (tanpa spasi juga boleh)
   EMAIL_TO=namaanda@gmail.com
   ```

4. Aktifkan di `config.yaml`:

   ```yaml
   email:
     enabled: true
     events: [trade_open, trade_close, alert, error, daily_report, daily_limit]
   ```

Email dikirim via SMTP SSL (port 465). Kegagalan kirim **tidak pernah**
mengganggu engine — hanya dicatat di log. Laporan harian (`daily_report`)
dikirim otomatis saat pergantian hari UTC (00:00 UTC = 07:00 WIB).

---

## 9. Menghubungkan ke Dashboard

### 9.1 Dashboard di PC yang sama (paling mudah)

1. Jalankan engine: `python main.py` (biarkan tetap berjalan).
2. Buka dashboard Next.js FINEX di browser.
3. Masuk tab **Settings** → bagian **Engine**:
   - **Engine Mode** → pilih **LIVE**.
   - **Engine URL** → `http://localhost:8000`.
4. Simpan. Header dashboard kini menampilkan data real: balance, equity,
   harga live, jumlah posisi, dan badge mode `LIVE`.

Dashboard mem-poll `GET /api/v1/poll` engine (timeout 2,5 detik) setiap ± 2
detik lewat proxy `/api/engine`. Bila engine mati/tidak terjangkau, dashboard
otomatis fallback ke data DEMO dan menampilkan `connected=false`.

### 9.2 Dashboard di PC/lain (engine di PC Windows, dashboard di device lain)

1. Ubah `config.yaml`:

   ```yaml
   api:
     host: 0.0.0.0    # dengarkan semua interface (default 127.0.0.1)
     port: 8000
   ```

2. Buka firewall Windows: *Settings → Privacy & Security → Windows Security →
   Firewall → Advanced Settings → Inbound Rules → New Rule* → Port → TCP 8000
   → Allow (profil Private).
3. Cari IP PC engine (`ipconfig`), mis. `192.168.1.20`.
4. Di dashboard (PC lain / laptop / tablet di jaringan sama), set
   **Engine URL** = `http://192.168.1.20:8000`.

> ⚠️ Jangan ekspos port 8000 ke internet publik tanpa proteksi tambahan —
> endpoint order engine tidak memakai autentikasi. Untuk pemakaian rumah,
> batasi pada jaringan lokal (Private) saja.

---

## 10. API Engine

Base URL: `http://localhost:8000`. Dokumentasi interaktif (Swagger):
<http://localhost:8000/docs>.

| Method & Path | Fungsi | Bentuk respons |
|---|---|---|
| `GET /api/v1/poll` | **Polling utama dashboard** (dipanggil `/api/engine`, timeout 2.5s; murni baca cache — dijamin cepat) | `EnginePollResponse` |
| `GET /api/v1/health` | Health check ringan | `{ok, mt5, version, uptime}` |
| `GET /api/v1/positions` | Posisi terbuka milik engine (magic number) | `PositionView[]` |
| `GET /api/v1/history?limit=50` | Riwayat posisi tertutup | `ClosedTrade[]` |
| `POST /api/v1/orders` | Trading manual | `{action:'open'\|'close'\|'closeAll'\|'modify', pair, side, volume, stopLossPips, takeProfitPips, riskBased, positionId, stopLoss, takeProfit, trailing, comment}` |
| `GET /api/v1/candles?pair=EURUSD&tf=M15&limit=200` | Candle historis MT5 | `Candle[]` |
| `GET /api/v1/news` | Berita terbaru | `NewsItemView[]` |
| `GET /api/v1/calendar` | Kalender ekonomi | `CalendarEvent[]` |
| `GET \| POST /api/v1/settings` | Lihat / patch konfigurasi runtime (mode, pair, sesi, TF, indikator, risiko) — tersimpan ke `config.yaml` | ringkasan settings |
| `GET \| POST /api/v1/alerts` | Lihat / tambah alert harga `{pair, condition: ABOVE\|BELOW, price, note}` | `AlertView[]` |
| `GET /api/v1/logs?level&category&q&limit` | Log engine (terbaru dulu) | `LogEntryView[]` |

Contoh:

```bat
curl http://localhost:8000/api/v1/health

curl -X POST http://localhost:8000/api/v1/orders -H "Content-Type: application/json" ^
  -d "{\"action\":\"open\",\"pair\":\"EURUSD\",\"side\":\"BUY\",\"riskBased\":true,\"stopLossPips\":10}"

curl -X POST http://localhost:8000/api/v1/alerts -H "Content-Type: application/json" ^
  -d "{\"pair\":\"XAUUSD\",\"condition\":\"ABOVE\",\"price\":2650.5,\"note\":\"breakout emas\"}"
```

Aturan order (sama seperti demo): validasi pair/side, **maksimal posisi**
sesuai `risk.max_positions` (1–3), **lot di-clamp 0.01–50** + step broker,
`riskBased=true` → lot = equity × risk% ÷ (SL pips × pip value).

---

## 11. Arsitektur Engine

```
                         ┌──────────────────────────────────────────────┐
                         │                python main.py                │
                         └──────────────────────────────────────────────┘
                                            │
        ┌───────────────┬───────────────┬───┴───────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
  [tick 1s]      [strategy 15s]  [positions 1s]   [news 5mnt]    [alerts 2s]
  harga+akun     gate harian     refresh posisi   Finnhub+       cek alert
  daily roll     gate sesi       trailing stop    MarketAux      vs harga
  status sesi    gate news       deteksi close    + kalender     → email
  latency MT5    max posisi      (SL/TP/MANUAL)  + sentimen AI
                 kandidat pair   ML self-learn
                 TF (aturan ATR) stop-out 20%
                 skor indikator
                 +ML +LLM → lot
                 → market_order
        │               │               │               │               │
        └───────────────┴───────┬───────┴───────────────┴───────────────┘
                                ▼
                   ┌─────────────────────────┐        ┌──────────────────┐
                   │  AppState (thread-safe) │◄──────►│  MT5Client       │
                   │  prices/positions/      │        │  (terminal64.exe │
                   │  history/news/calendar/ │        │   auto-launch +  │
                   │  status/account         │        │   registry)      │
                   └───────────┬─────────────┘        └──────────────────┘
                               ▼  (cache, tanpa MT5 — selalu < 2.5 detik)
                   ┌─────────────────────────┐
                   │  FastAPI + uvicorn      │◄── poll tiap 2s ── Next.js
                   │  :8000 /api/v1/*        │                    dashboard
                   └─────────────────────────┘
                               │
                 ┌─────────────┼─────────────┬──────────────┐
                 ▼             ▼             ▼              ▼
           app.indicators app.strategy  app.ml_model  app.emailer
           (30 indikator) (quick/analyze)(SGD online)  (SMTP notice)
                                            │
                                      models/model.joblib
                                      + weights.json (persist)
```

Alur keputusan AI (mode `ai`, tiap ± 15 detik):

1. **Gate harian** — daily P/L ≤ −`daily_risk_limit`% (LIMIT) atau ≥
   `daily_target`% (TARGET) → berhenti (anti-MC) + email.
2. **Gate sesi** — minimal satu sesi terpilih sedang aktif (UTC).
3. **Gate news** — tidak ada event HIGH impact ± 15 menit.
4. **Gate posisi** — jumlah posisi < `max_positions`, pair belum open.
5. **Kandidat** — manual: daftar pair user; AI: top-2 pair teraktif.
6. **Timeframe** — manual: pilihan user; AI: `ATR14(M15) > 1.5×ATR14(M1)`
   (pips) → M5, else M15.
7. **Skor** — voting 30 indikator berbobot (bobot hasil belajar) + prediksi
   ML → quick_analysis; lalu refine `analyze()` = blend 50/50 dengan LLM.
8. **Eksekusi** — |skor| ≥ 25 → SL (5–15 pips / ATR×1.2), TP = SL × rasio,
   lot = equity × risk% ÷ (SL × pip value) → `market_order` dengan magic
   number + comment `AI|provider|score=X|tf=Y` → log + email.
9. **Belajar** — setiap posisi AI tertutup (SL/TP/manual), bobot indikator
   dan model SGD diperbarui (win +0.08 / loss −0.06, clamp 0.2–3.0) dan
   dipersist ke `models/`.

---

## 12. Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `terminal64.exe tidak ditemukan` | Terminal terinstall di lokasi tidak standar | Isi `MT5_PATH` di `.env` dengan path lengkap `terminal64.exe`. |
| `Terminal tidak merespons dalam 60 detik` | Login salah / tombol Algo Trading mati / terminal menunggu dialog | Cek `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER`; nyalakan **Algo Trading** di terminal; tutap dialog pop-up terminal; naikkan `mt5.timeout_seconds`. |
| `mt5.initialize gagal: (-6, Authorization failed)` | Kredensial/server salah | Pastikan server persis (mis. `FINEX-Live`), password akun trading (bukan password investor). |
| Dashboard tetap `connected=false` padahal engine jalan | engineUrl salah / engine di PC lain / firewall | Set Engine URL `http://localhost:8000`; bila beda PC: `api.host: 0.0.0.0` + inbound rule TCP 8000 + pakai IP LAN. |
| `IPC initialize failed` / `Failed to initialize IPC` | Terminal 32-bit, atau MetaTrader5 pip tidak cocok versi Python | Install **Python 64-bit** + terminal 64-bit; `pip install --upgrade MetaTrader5`. |
| Order ditolak `retcode=10027` (AutoTrading disabled) | Tombol Algo Trading OFF di terminal | Nyalakan tombol **Algo Trading** (toolbar terminal) hingga hijau. |
| Order ditolak `retcode=10018` (market closed) | Pasar tutup (akhir pekan) / symbol sleep | Normal di weekend; tunggu market buka (Minggu 22:00 UTC). |
| `Symbol XXX tidak tersedia di broker` | Nama symbol berbeda di FINEX | Cek nama persis di Market Watch; hubungi developer bila berprefiks. |
| Berita kosong terus | API key belum diisi / quota habis | Isi `FINNHUB_API_KEY` / `MARKETAUX_API_KEY` (bagian 7); kalender tetap jalan tanpa key. |
| `AI '...' gagal` / analisa `live=false` | API key provider kosong/salah, quota, atau internet | Isi key provider di `.env`, restart engine; cek `GET /api/v1/health`; engine tetap fallback analisa lokal. |
| Email tidak terkirim | App password salah / port diblokir ISP | Pakai Gmail App Password (bukan password biasa); pastikan port 465 SSL tidak diblokir; cek log `[finex.emailer]`. |
| `Margin level rendah` / posisi ditutup paksa | Equity turun, margin level < 50% (MC) / < 20% (SO) | Kurangi lot, turunkan `max_positions`, pastikan daily limit aktif; engine menutup posisi terburuk otomatis di < 20% sebagai mitigasi. |
| `Paket MetaTrader5 tidak terpasang` | Jalan di luar Windows / Python 32-bit | Engine hanya jalan penuh di Windows + Python 64-bit. |
| Log ke mana? | — | `logs/engine.log` (buka juga di tab Logs dashboard via `GET /api/v1/logs`). |
| Port 8000 dipakai aplikasi lain | — | Ubah `api.port` di `config.yaml` + engineUrl dashboard. |
| Positif AI tidak muncul-muncul | Semua gate menolak (sesi/news/skor lemah) | Lihat `status.lastAiDecision` di `/api/v1/poll` — alasan skip selalu tertulis; cek log DEBUG (`FINEX_LOG_LEVEL=DEBUG`). |

---

## 13. Catatan Keamanan & Risiko

- **Hanya jalankan satu instance engine** untuk satu akun. Magic number
  (`trading.magic: 880042`) menandai posisi milik engine — posisi yang Anda
  buka manual di terminal (tanpa magic) tidak akan dilacak dashboard.
- Parameter risiko di-clamp ke rentang aman FINEX: risk/trade 0.5–1%, SL 5–15
  pips, RR hingga 1:3, max posisi 1–3, daily limit 2–3%, target harian 1–3%.
- **Mulai konservatif**: `risk_per_trade: 0.5`, `max_positions: 1`, lot
  minimal, `avoid_news: true`, trailing ON. Naikkan bertahap hanya setelah
  hasil terbukti konsisten.
- **Backtest dulu** di tab Backtest dashboard (mode DEMO) sebelum memakai
  kombinasi indikator/parameter baru di LIVE.
- Model ML belajar dari trade AI yang dibuka **sejak engine terakhir start**
  (fitur entry disimpan di memori; bobot/model dipersist di `models/`).
  Restart engine tidak menghilangkan bobot yang sudah dipelajari.
- Selalu update `.env` bila ganti password akun trading.
- Matikan engine (`Ctrl+C`) dan tutup posisi manual bila akan uninstall
  terminal MT5 atau maintenance PC.

---

*FINEX AI Trading Engine v1.0.0 — dibuat untuk FINEX Indonesia.
Gunakan dengan bijak. Trading mengandung risiko kehilangan dana.*
