# Arsitektur Sistem — FXQuant AI

Dokumen ini menjelaskan arsitektur teknis dashboard trading FXQuant AI, komponen-komponen utama, alur data, dan keputusan desain.

---

## Diagram Arsitektur

```
+-------------------+        +-------------------+        +-------------------+
|   Browser (Anda)  | <----> |  Dashboard Web    | <----> |  MT5 Python Bridge|
|  React Dashboard  |  HTTP  |  (Next.js 16)     |  HTTP  |  (Windows 11)     |
|                   |  poll  |  Port 3000        |  poll  |  MetaTrader5 lib  |
+-------------------+  2.5s  +-------------------+        +-------------------+
                                      |
                                      +-------> +-------------------+
                                      |        |  AI Engine        |
                                      |        |  z-ai-web-dev-sdk |
                                      |        |  (LLM server-only)|
                                      |        +-------------------+
                                      |
                                      v
                             +-------------------+
                             |  SQLite DB        |
                             |  (Prisma ORM)     |
                             |  Account, Trade,  |
                             |  Config, Log, ... |
                             +-------------------+
                                      |
                                      +-------> +-------------------+
                                               |  Market Data      |
                                               |  Simulator        |
                                               |  (sandbox)        |
                                               +-------------------+
```

---

## Komponen Utama

### 1. Dashboard Web (Next.js 16)

**Lokasi:** `src/` — aplikasi Next.js 16 dengan App Router, berjalan di port 3000.

**Tanggung jawab:**
- Merender UI trading terminal (React 19 + Tailwind CSS 4 + shadcn/ui)
- Menyediakan API routes untuk komunikasi dengan bridge, AI, dan DB
- Menyimpan konfigurasi dan kredensial di SQLite via Prisma
- Memanggil AI engine (z-ai-web-dev-sdk) untuk analisa pasar
- Mensimulasikan data market di sandbox (live ticks dari MT5 bridge di produksi)

**Entry point:** `src/app/page.tsx` → `TradingShell` (`src/components/trading-shell.tsx`)

**Single route:** Dashboard menggunakan satu route `/` dengan navigasi internal berbasis state Zustand (`section: overview | ai | trading | ...`). Tidak ada route lain yang ter-expose ke user.

### 2. AI Engine

**Lokasi:** `src/lib/ai.ts` (server-only, menggunakan `import "server-only"`)

**Tanggung jawab:**
- Menganalisa pair forex multi-faktor menggunakan LLM
- Menghasilkan sinyal BUY/SELL/NEUTRAL + confidence + 7 faktor heatmap + Entry/SL/TP
- Menyimpan hasil analisa ke DB untuk self-learning memory
- Mendukung chat AI untuk pertanyaan pasar

**Implementasi:** Menggunakan `z-ai-web-dev-sdk` yang memanggil LMAI besar secara server-side. System prompt menginstruksikan model untuk berperan sebagai analis forex kuantitatif scalping FINEX Indonesia, menganalisa 7 faktor (kebijakan bank sentral, data ekonomi, geopolitik, fiskal, komoditas, sentimen, breaking news), dan mengembalikan JSON terstruktur.

**Keamanan:** `z-ai-web-dev-sdk` HANYA boleh diimpor di server-side (API routes / server components). Tidak pernah di client component.

### 3. MT5 Python Bridge

**Lokasi:** Terpisah — berjalan di mesin Windows 11 user (lihat [MT5-BRIDGE.md](MT5-BRIDGE.md))

**Tanggung jawab:**
- Membaca kredensial MT5 dari dashboard DB (atau API)
- Meluncurkan aplikasi terminal MT5 (`terminal64.exe`)
- Memanggil `MetaTrader5.initialize()` + `.login()` untuk koneksi akun
- Mengeksekusi order (BUY/SELL) via `MetaTrader5.order_send()`
- Membaca account state (balance, equity, margin) dan post kembali ke dashboard
- Mendeteksi close posisi dan update DB

**Komunikasi dengan dashboard:** Bridge membaca/menulis ke API dashboard di `http://localhost:3000/api/*` (atau langsung ke SQLite DB untuk password yang di-mask).

### 4. Database SQLite

**Lokasi:** `db/custom.db` (di-gitignore, tidak pernah di-commit)

**ORM:** Prisma 6 (`prisma/schema.prisma`)

**Models:**
- `Account` — konfigurasi broker, kredensial MT5, balance/equity/margin, terminal config
- `Trade` — posisi open & closed (ticket, symbol, side, lot, SL/TP, PnL, source MANUAL/AI)
- `Configuration` — key/value store untuk trading config, risk config, API keys (JSON string)
- `IndicatorConfig` — state 30 indikator (enabled, autoMode, params, category)
- `Alert` — alert harga/email/news
- `Log` — log entries (INFO/WARN/ERROR/TRADE/AI)
- `Backtest` — hasil backtest runs
- `AiAnalysis` — riwayat analisa AI (self-learning memory)
- `Signal` — sinyal trading yang di-generate AI

**Singleton Account:** Hanya ada satu row Account (dibuat otomatis oleh `ensureAccount()`).

---

## Alur Data

### Alur 1: Market Data Live

```
MT5 Bridge (Windows)
  |
  | MetaTrader5.symbol_info_tick("EURUSD")
  v
Dashboard /api/market (GET, dipanggil setiap 2.5s oleh browser)
  |
  | getAllQuotes() — di sandbox: simulator random walk
  |                — di produksi: baca dari bridge/MT5
  v
Browser (Zustand store: quotes[Pair])
  |
  v
UI: Market Watch panel, P&L posisi live update
```

Di sandbox, market data di-simulasikan oleh `src/lib/market.ts` (random walk realistic per pair). Di produksi, bridge menulis tick ke DB atau endpoint khusus yang dibaca `/api/market`.

### Alur 2: AI Multi-Faktor Analysis

```
User klik "Analisa Semua Pair" (AI Section)
  |
  v
Client: runAnalysis() — fire Promise.all untuk setiap pair aktif
  |
  | POST /api/ai/analyze { symbol: "EURUSD" }
  | POST /api/ai/analyze { symbol: "GBPUSD" }   (paralel)
  v
Server: analyzeMarket(symbol)  [src/lib/ai.ts]
  |
  | ZAI.create() → zai.chat.completions.create({
  |   messages: [systemPrompt, userPrompt with pair context],
  |   thinking: { type: "disabled" }
  | })
  v
LLM mengembalikan JSON { signal, confidence, summary, factors[], entry, SL, TP }
  |
  | Parse JSON (extractJson helper)
  | Simpan ke AiAnalysis table (self-learning memory)
  | Log ke Log table (level=AI)
  v
Response ke client → update results[symbol] state
  |
  v
UI: PairSummaryGrid update per pair saat result kembali
     User klik kartu → lihat heatmap 7 faktor detail
```

### Alur 3: Eksekusi Trade Manual

```
User isi form (symbol, side, lot, SL, TP) → klik "Beli"
  |
  v
POST /api/trade/place { symbol, side, lotSize, stopLossPips, takeProfitPips, ... }
  |
  v
Server: validasi
  | 1. Cek max open positions (riskCfg.maxOpenPositions)
  | 2. Cek daily loss limit (anti-MC, riskCfg.dailyLossLimit)
  | 3. Hitung openPrice dari quote (bid/ask)
  | 4. Hitung SL/TP absolut dari pips
  v
DB: create Trade row (status=OPEN, source=MANUAL)
DB: update Account margin (notional / 500)
Log: TRADE level
  |
  v
(Produksi) Bridge membaca Trade OPEN → MetaTrader5.order_send()
           Bridge update ticket real ke DB
(Sandbox) Trade langsung OPEN, P&L dihitung dari quote live
  |
  v
Response ke client → upsertTrade(trade) → tabel posisi update
```

### Alur 4: Connect MT5 + Auto-Launch Terminal

```
User isi kredensial → klik "Sambungkan MT5"
  |
  v
Client: handleMt5Connect()
  | 1. PUT /api/mt5/credentials { mt5Account, mt5Password, mt5Server, ... }
  | 2. POST /api/mt5/connect { mt5Account, mt5Password, ... }
  v
Server /api/mt5/connect:
  | 1. Validasi account number (4-12 digit) & password
  | 2. Jika mt5AutoStartTerminal=true & path configured & not running:
  |      Launch terminal (simulasi: set mt5TerminalRunning=true, assign PID)
  |      (Produksi: bridge subprocess.Popen([terminal_path]) + mt5.initialize())
  | 3. Save credentials to Account row
  | 4. Set mt5Connected=true
  | 5. Log INFO
  v
Response { account: AccountState } → setAccount() → UI update
Client: refreshTerminalStatus() → terminal panel reflect auto-launch
```

### Alur 5: Backtesting

```
User konfigurasi (symbol, timeframe, strategy, date range, capital) → klik "Jalankan Backtest"
  |
  v
POST /api/backtest/run { symbol, timeframe, strategy, fromDate, toDate, initialCapital, riskPerTrade, rrRatio }
  |
  v
Server: generateCandles(symbol, 600, tfMinutes)  [src/lib/market.ts]
  |
  | Loop 600 candles:
  |   - Hitung EMA fast(9) & slow(21)
  |   - Strategy: EMA Crossover / Momentum Breakout / Mean Reversion / AI Hybrid
  |   - Entry signal → buka posisi (max 3 concurrent)
  |   - Cek exit (SL/TP hit)
  |   - Update equity, track max drawdown
  v
Hitung metrics: totalTrades, winRate, profitFactor, maxDrawdown, netProfit
  |
  v
DB: create Backtest row (result JSON = equity curve)
Log: INFO
  |
  v
Response { backtest, equityCurve } → UI render 6 stat cards + AreaChart
```

---

## State Management

### Client State (Zustand)

**File:** `src/lib/store.ts`

Store global tunggal dengan slice:
- `section` — navigasi aktif (overview/ai/trading/...)
- `quotes` — Record<Pair, Quote> live market data
- `account` — AccountState (balance, equity, mt5Connected, dll.)
- `trades` — TradeRow[] (open + closed)
- `logs`, `alerts`, `backtests`, `indicators` — collections
- `tradingCfg`, `riskCfg`, `apiKeys` — konfigurasi
- `toasts` — notification queue

**Pattern:** Selectors `useStore((s) => s.field)` untuk minimal re-renders.

### Server State

Tidak ada TanStack Query. Data server di-fetch via `fetch()` di `useEffect` on mount, atau on-demand saat user action. Beberapa endpoint di-poll (market 2.5s, trade list 5s).

---

## API Design

**Convention:** Next.js 16 App Router, semua route `force-dynamic` (no static generation).

**Response format:** JSON untuk semua endpoint.

**Auth:** Tidak ada auth (sandbox single-user). Untuk produksi, tambahkan NextAuth.js (sudah ter-install).

**Error handling:** HTTP status codes (400 bad request, 404 not found, 500 server error) + `{ error: "message" }` body dalam Bahasa Indonesia.

**Rate limiting:** Tidak ada. AI endpoints memiliki `maxDuration=60` (Next.js timeout).

Detail lengkap semua endpoint: [API.md](API.md)

---

## UI/UX Design

### Tema

**Default:** Dark trading terminal (oklch palette dengan aksen emerald/rose/amber/violet).

**Light mode:** Tersedia via toggle di topbar.

**Aturan warna:**
- Profit/positive = `text-emerald-400`
- Loss/negative = `text-rose-400`
- Warning = `text-amber-400`
- AI/accent = `text-violet-400`
- TIDAK ada indigo atau blue (sesuai panduan desain)

**Typography:** Geist Sans + Geist Mono (tabular-nums untuk angka via `.tnum` class).

### Layout

```
+----------------------------------------------------------+
| Sidebar (60) | Top Bar (leverage, equity, clock, AI)    |
|              +-------------------------------------------+
|  Nav (9)     |                                            |
|              |  Main Content (section)                   |
|  MT5 Status  |                                            |
|              |                                            |
|              +-------------------------------------------+
|              | Footer (sticky bottom)                    |
+----------------------------------------------------------+
```

- **Sidebar:** Navigasi 9 section + MT5 bridge status + connect button
- **Top bar:** Leverage badge, MT5 status, equity, day P&L, clock, active sessions, AI Auto toggle, theme toggle
- **Main:** Section content (max-width 1500px, centered)
- **Footer:** Sticky bottom (`mt-auto`), brand + risk warning

### Responsive

- Mobile-first: sidebar hidden di mobile, ganti dengan horizontal scroll nav
- Breakpoints: `sm` (640), `md` (768), `lg` (1024), `xl` (1280)
- Touch-friendly: minimum 44px touch targets

### Section Components

9 section di `src/components/sections/`:
1. `overview-section.tsx` — Dashboard operasional
2. `ai-section.tsx` — Pusat analisa AI multi-faktor
3. `trading-section.tsx` — Trading terminal
4. `indicators-section.tsx` — 30 indikator lab
5. `risk-section.tsx` — Manajemen risiko
6. `backtest-section.tsx` — Backtesting engine
7. `alerts-section.tsx` — Alert & notifikasi
8. `logs-section.tsx` — Log sistem
9. `settings-section.tsx` — Pengaturan (trading, AI provider, broker/MT5, risiko)

---

## Keputusan Desain

### Mengapa Next.js 16 App Router?
- Server-side API routes terintegrasi (tidak butuh backend terpisah)
- TypeScript end-to-end
- Streaming & server components untuk performance
- shadcn/ui ecosystem matang

### Mengapa SQLite + Prisma?
- Zero-config (file-based, tidak butuh server DB)
- Prisma memberi type safety & migrasi
- Cukup untuk single-user dashboard
- Mudah di-backup (copy file `db/custom.db`)

### Mengapa Zustand bukan Redux/Context?
- API sederhana, boilerplate minimal
- Selectors mencegah re-render berlebih
- Persist middleware tersedia jika dibutuhkan

### Mengapa z-ai-web-dev-sdk (bukan Groq/OpenAI langsung)?
- Terintegrasi di sandbox tanpa API key tambahan
- Server-only, aman (tidak expose key di client)
- Multi-provider: dashboard mendukung Groq/OpenAI/Together/Tinyfish via API keys (diisi di Settings), bridge Python yang memanggil provider lain di mesin user

### Mengapa MT5 Bridge terpisah (bukan di Next.js)?
- Library `MetaTrader5` Python HANYA jalan di Windows
- Next.js dashboard bisa di-deploy di Linux/VPS
- Pemisahan concern: UI vs eksekusi trading
- Bridge bisa di-restart tanpa mengganggu dashboard

### Mengapa market data di-simulasi di sandbox?
- Sandbox tidak punya akses MT5 terminal
- Simulasi memungkinkan demo UI/UX tanpa akun real
- Di produksi, bridge mensuplai tick real ke dashboard

---

## Deployment

### Sandbox (demo)
- `bun run dev` di port 3000
- Market data simulasi
- MT5 bridge tidak aktif (tombol connect simulasi)

### Produksi (trading real)
1. **Dashboard:** Deploy ke VPS Linux atau jalankan lokal
   - `bun run build` → `bun run start`
   - Atau Docker container
2. **MT5 Bridge:** Jalankan di Windows 11 VPS atau PC lokal
   - Install MT5 + Python 3.14 + MetaTrader5 library
   - Jalankan `mt5_bridge.py` (lihat [MT5-BRIDGE.md](MT5-BRIDGE.md))
3. **Database:** Backup `db/custom.db` berkala
4. **Security:** Tambahkan auth (NextAuth), HTTPS, firewall

---

## Performance & Scaling

- **Market polling:** 2.5s interval (cukup untuk scalping M1)
- **AI analysis:** 10-20s per pair, paralel untuk multi-pair
- **DB queries:** Prisma dengan index pada ticket, status, openedAt
- **Bundle size:** Code splitting per section, lazy loading charts
- **Memory:** Quotes store dibatasi 4 pair, logs di-cap 500 entries

Untuk skala lebih besar (multi-user): ganti SQLite ke PostgreSQL, tambah Redis cache, implementasi WebSocket untuk push real-time (bukan polling).
