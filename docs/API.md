# API Reference — AI Forex Trading Dashboard (FINEX Indonesia)

Dokumen ini adalah referensi lengkap untuk seluruh endpoint REST API pada dashboard trading forex berbasis Next.js 16.

## Konvensi Umum

- **Base URL:** `http://localhost:3000` (mode pengembangan) atau URL produksi deploy Next.js.
- **Content-Type:** seluruh endpoint menerima dan mengembalikan `application/json`.
- **Dynamic rendering:** setiap endpoint mengekspor `export const dynamic = "force-dynamic"`, sehingga response tidak pernah di-cache dan selalu dieksekusi per request.
- **maxDuration:** endpoint AI (`/api/ai/*`) dan `/api/backtest/run` mengekspor `export const maxDuration = 60` (detik) karena memanggil LLM `z-ai-web-dev-sdk` atau menjalankan simulasi backtest panjang. Waktu responsi realistis untuk AI endpoint berkisar 10–20 detik.
- **Format error:** selalu `{ "error": "<pesan>" }` dengan HTTP status code non-2xx.
- **Format sukses:** bervariasi per endpoint, umumnya `{ "ok": true, ...payload }` atau langsung `{ "<key>": <data> }`.

## Daftar Endpoint

1. [Market Data](#market-data)
2. [Configuration](#configuration)
   - [Account](#account)
   - [Trading](#trading)
   - [Risk](#risk)
   - [API Keys](#api-keys)
3. [MT5 Bridge](#mt5-bridge)
   - [Connect](#connect)
   - [Credentials](#credentials)
   - [Disconnect](#disconnect)
   - [Start Terminal](#start-terminal)
   - [Stop Terminal](#stop-terminal)
   - [Terminal Status](#terminal-status)
4. [Trading](#trading-1)
   - [Place Order](#place-order)
   - [Close Order](#close-order)
   - [List Trades](#list-trades)
5. [AI](#ai)
   - [Analyze](#analyze)
   - [Signal](#signal)
   - [Chat](#chat)
6. [Backtesting](#backtesting)
   - [Run](#run)
   - [List](#list)
7. [Alerts](#alerts)
8. [Logs](#logs)
9. [Indicators](#indicators)
10. [Appendix — Type Definitions](#appendix--type-definitions)

---

## Market Data

### GET /api/market

Mengembalikan quote实时 (bid/ask/spread/change/high/low) untuk seluruh pair yang didukung (`EURUSD`, `USDJPY`, `GBPUSD`, `XAUUSD`). Quote dihasilkan oleh mesin mock market-data in-process (`@/lib/market`). Frontend polling endpoint ini setiap 2,5 detik untuk memperbarui Market Watch dan P&L live.

**Request:** tidak ada parameter.

**Response:** `200 OK`
```json
{
  "quotes": [
    {
      "symbol": "EURUSD",
      "bid": 1.08542,
      "ask": 1.08555,
      "spreadPips": 1.3,
      "changePct": 0.12,
      "last": 1.08555,
      "high": 1.08610,
      "low": 1.08490,
      "ts": 1718000000000
    }
  ],
  "ts": 1718000000000
}
```

**Errors:** tidak ada (selalu `200`).

**Example:**
```bash
curl http://localhost:3000/api/market
```

---

## Configuration

### Account

#### GET /api/config/account

Mengembalikan state akun trading (balance, equity, margin, status koneksi MT5, parameter Anti-MC). Data dibaca dari row Account tunggal di database lokal via `ensureAccount()`.

**Request:** tidak ada parameter.

**Response:** `200 OK`
```json
{
  "account": {
    "broker": "FINEX Indonesia",
    "login": "90123456",
    "server": "FINEX-Demo",
    "leverage": "1:500",
    "currency": "USD",
    "balance": 10000,
    "equity": 10000,
    "margin": 0,
    "freeMargin": 10000,
    "marginLevel": 0,
    "mt5Connected": false,
    "dailyLossUsed": 0,
    "dailyLossLimit": 3
  }
}
```

**Errors:** tidak ada (selalu `200`).

**Example:**
```bash
curl http://localhost:3000/api/config/account
```

### Trading

#### GET /api/config/trading

Mengembalikan konfigurasi trading global (pair aktif, timeframe, sesi, flag automation). Jika belum ada konfigurasi tersimpan, dikembalikan default.

**Request:** tidak ada parameter.

**Response:** `200 OK`
```json
{
  "config": {
    "pairs": ["EURUSD", "GBPUSD"],
    "timeframes": ["M5", "M15"],
    "sessions": ["London", "LondonNewYork"],
    "avoidWeekends": true,
    "autoMode": false,
    "trailingAuto": false,
    "indicatorAuto": false,
    "riskAuto": false
  }
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/config/trading
```

#### PUT /api/config/trading

Memperbarui konfigurasi trading. Menggunakan merge shallow dengan konfigurasi yang ada — field yang tidak dikirim tidak diubah.

**Request body:** `Partial<TradingConfig>` (sub-set dari struktur response di atas).

```json
{
  "pairs": ["EURUSD", "GBPUSD", "USDJPY"],
  "autoMode": true
}
```

**Response:** `200 OK`
```json
{
  "config": {
    "pairs": ["EURUSD", "GBPUSD", "USDJPY"],
    "timeframes": ["M5", "M15"],
    "sessions": ["London", "LondonNewYork"],
    "avoidWeekends": true,
    "autoMode": true,
    "trailingAuto": false,
    "indicatorAuto": false,
    "riskAuto": false
  }
}
```

**Errors:**
- `400 Bad Request` — body bukan JSON valid (Next.js default).
- `500` — kegagalan database.

**Example:**
```bash
curl -X PUT http://localhost:3000/api/config/trading \
  -H "Content-Type: application/json" \
  -d '{"autoMode": true, "pairs": ["EURUSD", "GBPUSD"]}'
```

### Risk

#### GET /api/config/risk

Mengembalikan konfigurasi manajemen risiko (risk per trade, rentang SL, RR ratio, max open positions, daily loss limit, daily target, flag Anti-MC).

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "config": {
    "riskPerTrade": 1,
    "stopLossPipsMin": 5,
    "stopLossPipsMax": 15,
    "rrRatio": 1.5,
    "maxOpenPositions": 3,
    "dailyLossLimit": 3,
    "avoidHighImpactNews": true,
    "dailyTarget": 2,
    "autoMode": false
  }
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/config/risk
```

#### PUT /api/config/risk

Memperbarui konfigurasi risiko. Merge shallow dengan nilai yang ada.

**Request body:** `Partial<RiskConfig>`.
```json
{
  "riskPerTrade": 1.5,
  "maxOpenPositions": 5,
  "dailyLossLimit": 4
}
```

**Response:** `200 OK`
```json
{
  "config": {
    "riskPerTrade": 1.5,
    "stopLossPipsMin": 5,
    "stopLossPipsMax": 15,
    "rrRatio": 1.5,
    "maxOpenPositions": 5,
    "dailyLossLimit": 4,
    "avoidHighImpactNews": true,
    "dailyTarget": 2,
    "autoMode": false
  }
}
```

**Errors:**
- `400` — body JSON invalid.
- `500` — kegagalan database.

**Example:**
```bash
curl -X PUT http://localhost:3000/api/config/risk \
  -H "Content-Type: application/json" \
  -d '{"riskPerTrade": 1.5, "maxOpenPositions": 5}'
```

### API Keys

#### GET /api/config/keys

Mengembalikan daftar API key milik provider AI (Groq, OpenAI, Together, Tinyfish) dan data provider (Finnhub, Marketaux), serta `activeProvider`. Semua nilai string key dimasking dengan algoritma:

- Jika panjang ≤ 8 karakter → seluruhnya `•`.
- Jika lebih → 4 karakter pertama + `•` berulang (min 4) + 4 karakter terakhir.

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "keys": {
    "groq": "gsk_•••••••abcd",
    "openai": "sk-•••••••wxyz",
    "together": "",
    "tinyfish": "",
    "finnhub": "",
    "marketaux": "",
    "activeProvider": "zai"
  }
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/config/keys
```

#### PUT /api/config/keys

Memperbarui API keys. Setiap field string yang **mengandung karakter `•`** akan **diabaikan** sehingga nilai masked yang diterima dari GET tidak akan menimpa nilai asli. Field non-string (mis. `activeProvider`) ditimpa apa adanya.

**Request body:** `Partial<ApiKeys>`.
```json
{
  "groq": "gsk_newRealKey12345",
  "activeProvider": "groq"
}
```

**Response:** `200 OK`
```json
{ "ok": true }
```

**Errors:**
- `400` — body JSON invalid.
- `500` — kegagalan database.

**Example:**
```bash
curl -X PUT http://localhost:3000/api/config/keys \
  -H "Content-Type: application/json" \
  -d '{"groq": "gsk_realKey", "activeProvider": "groq"}'
```

---

## MT5 Bridge

Endpoint ini mengelola koneksi dashboard ke MT5 Python bridge (berjalan di mesin Windows pengguna). Di sandbox, koneksi disimulasikan — field `mt5Connected` di-toggle dan margin diubah. Di produksi, bridge membaca kredensial dari DB yang sama dan memanggil `MetaTrader5.login()`.

### Connect

#### POST /api/mt5/connect

Menyimpan kredensial MT5 yang diberikan pada row Account dan menandai bridge sebagai `mt5Connected = true`. Jika body kosong, endpoint menggunakan kredensial yang sudah tersimpan (cocok untuk tombol "Sambungkan" setelah kredensial disimpan).

Saat `mt5AutoStartTerminal = true` dan `mt5TerminalPath` sudah dikonfigurasi dan terminal belum berjalan, terminal MT5 juga otomatis di-launch (PID di-generate pseudo-random).

**Request body:** (semua field opsional)
```typescript
interface ConnectBody {
  mt5Account?: string;        // 4-12 digit angka
  mt5Password?: string;       // minimal 4 karakter
  mt5Server?: string;         // tidak boleh kosong/whitespace
  mt5AccountType?: "demo" | "real";
  mt5Terminal?: string;       // default "MetaTrader5"
}
```

**Response:** `200 OK`
```json
{
  "account": { /* AccountState lengkap, lihat GET /api/config/account */ },
  "ok": true
}
```

**Errors:**
- `400 Bad Request`:
  - `"Nomor akun MT5 harus 4-12 digit angka"` — `mt5Account` tidak match `^\d{4,12}$`.
  - `"Password MT5 minimal 4 karakter"` — `mt5Password.length < 4`.
  - `"Server MT5 wajib diisi"` — `mt5Server` kosong / hanya whitespace.
  - `"Nomor akun MT5 dan password wajib diisi..."` — body kosong tapi belum ada kredensial tersimpan.

**Example:**
```bash
curl -X POST http://localhost:3000/api/mt5/connect \
  -H "Content-Type: application/json" \
  -d '{
    "mt5Account": "90123456",
    "mt5Password": "mySecretPass",
    "mt5Server": "FINEX-Demo",
    "mt5AccountType": "demo"
  }'
```

### Credentials

#### GET /api/mt5/credentials

Mengembalikan kredensial MT5 yang tersimpan. Password **dimasking** (`m••••••t` — 1 karakter pertama + `•` + 1 karakter terakhir). Field `hasPassword` menandakan apakah password tersimpan (tanpa reveal). Juga mengembalikan konfigurasi terminal (path, running, pid, autoStart).

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "credentials": {
    "mt5Account": "90123456",
    "mt5Password": "m••••••t",
    "mt5Server": "FINEX-Demo",
    "mt5AccountType": "demo",
    "mt5Terminal": "MetaTrader5",
    "hasPassword": true
  },
  "terminal": {
    "path": "C:\\Program Files\\MetaTrader 5\\terminal64.exe",
    "running": true,
    "pid": 7447,
    "autoStart": true
  }
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/mt5/credentials
```

#### PUT /api/mt5/credentials

Memperbarui kredensial MT5 dan/atau konfigurasi terminal. Password yang mengandung `•` **diabaikan** (sehingga UI bisa mengirim nilai masked tanpa menimpa password asli). Field `mt5TerminalPath` di-set ke `null` jika string kosong.

**Request body:** (semua opsional)
```typescript
{
  mt5Account?: string;            // harus match ^\d{4,12}$
  mt5Password?: string;           // min 4 karakter; diabaikan jika mengandung "•"
  mt5Server?: string;
  mt5AccountType?: "demo" | "real";
  mt5Terminal?: string;
  mt5TerminalPath?: string;       // path ke terminal64.exe
  mt5AutoStartTerminal?: boolean;
}
```

**Response:** `200 OK`
```json
{ "ok": true }
```

**Errors:**
- `400`:
  - `"Nomor akun MT5 harus 4-12 digit angka"` — `mt5Account` invalid.
  - `"Password MT5 minimal 4 karakter"` — password baru (tanpa `•`) kurang dari 4 karakter.

**Example:**
```bash
curl -X PUT http://localhost:3000/api/mt5/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "mt5TerminalPath": "C:\\Program Files\\MetaTrader 5\\terminal64.exe",
    "mt5AutoStartTerminal": true
  }'
```

### Disconnect

#### POST /api/mt5/disconnect

Memutuskan bridge MT5: men-set `mt5Connected = false` dan `margin = 0`. Kredensial yang tersimpan **tetap dipertahankan** agar reconnect cepat. Tidak menerima body.

**Request:** tidak ada body.

**Response:** `200 OK`
```json
{
  "account": { /* AccountState lengkap */ },
  "ok": true
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl -X POST http://localhost:3000/api/mt5/disconnect
```

### Start Terminal

#### POST /api/mt5/start-terminal

Meluncurkan aplikasi MT5 Terminal (`terminal64.exe`). Di sandbox, mensimulasikan latency ~600ms lalu men-set `mt5TerminalRunning = true` dan men-assign pseudo-PID acak antara 2000–9999. Di produksi, bridge menjalankan `subprocess.Popen([path])` lalu poll `MetaTrader5.initialize(path)`.

**Request:** tidak ada body.

**Response:** `200 OK` (terminal sudah berjalan sebelumnya)
```json
{
  "ok": true,
  "alreadyRunning": true,
  "message": "Terminal MT5 sudah berjalan",
  "pid": 7447
}
```

**Response:** `200 OK` (baru diluncurkan)
```json
{
  "ok": true,
  "alreadyRunning": false,
  "pid": 3380,
  "path": "C:\\Program Files\\MetaTrader 5\\terminal64.exe",
  "message": "Terminal MT5 dijalankan (PID 3380)"
}
```

**Errors:**
- `400 Bad Request`:
  - `"Path terminal MT5 belum dikonfigurasi..."` — `mt5TerminalPath` kosong. User harus mengisi path di Settings → Broker / MT5.

**Example:**
```bash
curl -X POST http://localhost:3000/api/mt5/start-terminal
```

### Stop Terminal

#### POST /api/mt5/stop-terminal

Menghentikan aplikasi MT5 Terminal. Men-set `mt5TerminalRunning = false`, `mt5TerminalPid = null`, dan **juga memutuskan bridge** (`mt5Connected = false`, `margin = 0`) karena terminal yang berhenti membuat koneksi MT5 tidak valid. Di produksi bridge menjalankan `MetaTrader5.shutdown()` dan opsional `taskkill /PID`.

**Request:** tidak ada body.

**Response:** `200 OK` (terminal sedang berjalan, baru dihentikan)
```json
{
  "ok": true,
  "alreadyStopped": false,
  "message": "Terminal MT5 dihentikan"
}
```

**Response:** `200 OK` (terminal sudah berhenti)
```json
{
  "ok": true,
  "alreadyStopped": true,
  "message": "Terminal MT5 tidak sedang berjalan"
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl -X POST http://localhost:3000/api/mt5/stop-terminal
```

### Terminal Status

#### GET /api/mt5/terminal-status

Mengembalikan status terminal MT5 saat ini (berjalan/belum, PID, path, autoStart). Tidak memodifikasi state.

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "running": true,
  "pid": 7447,
  "path": "C:\\Program Files\\MetaTrader 5\\terminal64.exe",
  "autoStart": true
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/mt5/terminal-status
```

---

## Trading

### Place Order

#### POST /api/trade/place

Membuka posisi trading baru. Endpoint menerapkan **dua safety guard** sebelum eksekusi:

1. **Max open positions** — menolak jika jumlah trade `OPEN` saat ini ≥ `riskCfg.maxOpenPositions`.
2. **Anti-MC daily loss limit** — menolak jika `account.dailyLossUsed` ≥ `riskCfg.dailyLossLimit`.

Open price diambil dari quote live (`ask` untuk BUY, `bid` untuk SELL). SL/TP absolut dihitung berdasarkan `pipSize` pair. Margin diestimasi sebagai `(lotSize × 100000 × openPrice) / 500` (asumsi leverage 1:500) dan diinkrement ke field `account.margin` (freeMargin di-decrement).

Default SL = `min(max(stopLossPipsMin, 8), stopLossPipsMax)` pips; default TP = `SL × rrRatio`.

**Request body:**
```typescript
interface PlaceBody {
  symbol: Pair;                 // "EURUSD" | "USDJPY" | "GBPUSD" | "XAUUSD"
  side: Side;                   // "BUY" | "SELL"
  lotSize: number;              // e.g. 0.01
  stopLossPips?: number;
  takeProfitPips?: number;
  trailingStop?: boolean;
  trailingPips?: number;
  source?: "MANUAL" | "AI";     // default "MANUAL"
  strategy?: string;
}
```

**Response:** `200 OK`
```json
{
  "trade": {
    "id": "cuid123",
    "ticket": "806544123",
    "symbol": "EURUSD",
    "side": "BUY",
    "lotSize": 0.01,
    "openPrice": 1.08555,
    "closePrice": null,
    "stopLoss": 1.08475,
    "takeProfit": 1.08675,
    "trailingStop": false,
    "trailingPips": null,
    "slPips": 8,
    "tpPips": 12,
    "pnl": 0,
    "pips": 0,
    "status": "OPEN",
    "source": "MANUAL",
    "strategy": null,
    "openedAt": "2024-06-10T08:30:00.000Z",
    "closedAt": null
  },
  "ok": true
}
```

**Errors:**
- `400 Bad Request`:
  - `{ "error": "Invalid symbol" }` — `symbol` tidak ditemukan di `PAIRS`.
  - `{ "error": "Maksimal <N> posisi terbuka tercapai" }` — guard max open positions terpicu. Juga menulis log `WARN/RISK`.
  - `{ "error": "Daily risk limit <N>% tercapai (Anti-MC). Trading dihentikan hari ini." }` — guard Anti-MC terpicu. Juga menulis log `WARN/RISK`.

**Example:**
```bash
curl -X POST http://localhost:3000/api/trade/place \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "side": "BUY",
    "lotSize": 0.01,
    "stopLossPips": 8,
    "takeProfitPips": 12
  }'
```

### Close Order

#### POST /api/trade/close

Menutup posisi `OPEN` berdasarkan `id`. Menghitung P&L dari quote live (`bid` untuk BUY, `ask` untuk SELL) menggunakan rumus:

- `pips = side === "BUY" ? (closePrice - openPrice) / pipSize : (openPrice - closePrice) / pipSize`
- `pipValue = symbol === "XAUUSD" ? 1 : 10` (USD per pip per lot, aproksimasi)
- `pnl = pips × pipValue × lotSize`

Setelah close: `account.balance` dan `equity` di-update ke `newBalance = oldBalance + pnl`, `margin` di-decrement, `freeMargin` di-increment. Jika `pnl < 0`, `dailyLossUsed` di-increment dengan `(|pnl| / balance) × 100`.

**Request body:**
```json
{ "id": "cuid123" }
```

**Response:** `200 OK`
```json
{
  "trade": {
    "id": "cuid123",
    "ticket": "806544123",
    "symbol": "EURUSD",
    "side": "BUY",
    "lotSize": 0.01,
    "openPrice": 1.08555,
    "closePrice": 1.08625,
    "stopLoss": 1.08475,
    "takeProfit": 1.08675,
    "trailingStop": false,
    "trailingPips": null,
    "slPips": 8,
    "tpPips": 12,
    "pnl": 7.0,
    "pips": 7.0,
    "status": "CLOSED",
    "source": "MANUAL",
    "strategy": null,
    "openedAt": "2024-06-10T08:30:00.000Z",
    "closedAt": "2024-06-10T09:15:00.000Z"
  },
  "ok": true
}
```

**Errors:**
- `404 Not Found`:
  - `{ "error": "Trade not found / not open" }` — `id` tidak ditemukan atau status trade bukan `OPEN`.

**Example:**
```bash
curl -X POST http://localhost:3000/api/trade/close \
  -H "Content-Type: application/json" \
  -d '{"id": "cuid123"}'
```

### List Trades

#### GET /api/trade/list

Mengembalikan hingga 200 trade terbaru (termasuk OPEN dan CLOSED) diurutkan dari `openedAt` terbaru. Frontend mengelompokkan OPEN lebih dulu lalu CLOSED.

**Request:** tidak ada parameter.

**Response:** `200 OK`
```json
{
  "trades": [
    {
      "id": "cuid456",
      "ticket": "806544999",
      "symbol": "GBPUSD",
      "side": "SELL",
      "lotSize": 0.02,
      "openPrice": 1.27150,
      "closePrice": null,
      "stopLoss": 1.27230,
      "takeProfit": 1.27030,
      "trailingStop": false,
      "trailingPips": null,
      "slPips": 8,
      "tpPips": 12,
      "pnl": 0,
      "pips": 0,
      "status": "OPEN",
      "source": "MANUAL",
      "strategy": null,
      "openedAt": "2024-06-10T10:00:00.000Z",
      "closedAt": null
    }
  ]
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/trade/list
```

---

## AI

Endpoint ini memanggil **LLM asli** melalui `z-ai-web-dev-sdk` (lihat `@/lib/ai`). Waktu responsi realistis **10–20 detik** per request. Setiap endpoint mengekspor `maxDuration = 60`. Frontend menampilkan loading state multi-faktor yang detail selama menunggu.

### Analyze

#### POST /api/ai/analyze

Menjalankan analisa multi-faktor AI untuk satu pair. AI mengevaluasi 7 faktor (Bank Sentral, Data Ekonomi, Geopolitik, Fiskal, Komoditas, Sentimen, Breaking News) dan mengembalikan sinyal, confidence, summary, heatmap faktor, serta suggested Entry/SL/TP. Hasil disimpan ke tabel `AiAnalysis` untuk self-learning memory, dan sebuah log `AI/ANALYSIS` ditulis.

**Request body:**
```json
{ "symbol": "EURUSD" }
```

**Response:** `200 OK`
```json
{
  "analysis": {
    "symbol": "EURUSD",
    "signal": "SELL",
    "confidence": 75,
    "summary": "Sentimen bearish: USD menguat setelah data NFP...",
    "factors": [
      {
        "factor": "Kebijakan Bank Sentral",
        "direction": "SELL",
        "score": -60,
        "detail": "Fed hawkish; ECB dovish → EUR lemah."
      },
      {
        "factor": "Data Ekonomi Utama",
        "direction": "SELL",
        "score": -80,
        "detail": "NFP AS di atas ekspektasi..."
      }
    ],
    "suggestedEntry": 1.08550,
    "suggestedStopLoss": 1.08630,
    "suggestedTakeProfit": 1.08390
  }
}
```

**Errors:**
- `400 Bad Request`:
  - `{ "error": "symbol required" }` — body tidak berisi `symbol`.
- `500` — kegagalan LLM atau database (jarang; biasanya timeout 60s).

**Example:**
```bash
curl -X POST http://localhost:3000/api/ai/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbol": "EURUSD"}'
```

#### GET /api/ai/analyze

Mengembalikan 30 riwayat analisa AI terbaru (untuk tab "Riwayat" di UI).

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "history": [
    {
      "id": "cuid789",
      "symbol": "EURUSD",
      "factors": "[{\"factor\":\"...\",\"score\":-60}]",
      "summary": "Sentimen bearish...",
      "signal": "SELL",
      "confidence": 75,
      "provider": "zai",
      "createdAt": "2024-06-10T10:00:00.000Z"
    }
  ]
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/ai/analyze
```

### Signal

#### POST /api/ai/signal

Membuat sinyal trading konkret dari analisa AI. Memanggil `analyzeMarket(symbol)` lalu:

- Jika `signal === "NEUTRAL"` **atau** `confidence < 55` → sinyal disimpan dengan `status = "SKIPPED"` dan dikembalikan `{ signal: null, reason: ... }`.
- Jika tidak → sinyal disimpan dengan `status = "PENDING"` dan dikembalikan lengkap dengan id, side, entry/SL/TP, confidence, reason.

Frontend menggunakan endpoint ini saat user menekan tombol "Eksekusi Sinyal".

**Request body:**
```json
{ "symbol": "EURUSD" }
```

**Response:** `200 OK` (sinyal dieksekusi)
```json
{
  "signal": {
    "id": "cuid999",
    "symbol": "EURUSD",
    "side": "SELL",
    "entry": 1.0855,
    "stopLoss": 1.0863,
    "takeProfit": 1.0839,
    "confidence": 75,
    "reason": "Sentimen bearish: USD menguat..."
  },
  "analysis": { /* AiAnalysisResult lengkap, sama seperti POST /api/ai/analyze */ }
}
```

**Response:** `200 OK` (sinyal di-skip)
```json
{
  "signal": null,
  "reason": "Confidence 45% di bawah threshold 55% atau sinyal NEUTRAL. Tidak ada eksekusi.",
  "analysis": { /* AiAnalysisResult lengkap */ }
}
```

**Errors:**
- `400 Bad Request`:
  - `{ "error": "symbol required" }`.
- `500` — kegagalan LLM atau database.

**Example:**
```bash
curl -X POST http://localhost:3000/api/ai/signal \
  -H "Content-Type: application/json" \
  -d '{"symbol": "EURUSD"}'
```

### Chat

#### POST /api/ai/chat

Mengirim pesan ke AI chat assistant (LLM asli via `z-ai-web-dev-sdk`). Menerima balasan teks bebas. Tidak menyimpan history ke database — frontend mempertahankan context percakapan secara in-memory.

**Request body:**
```json
{ "message": "Apa prospek EURUSD minggu ini?" }
```

**Response:** `200 OK`
```json
{
  "reply": "Berdasarkan kondisi makro saat ini, EURUSD kemungkinan..."
}
```

**Errors:**
- `400 Bad Request`:
  - `{ "error": "message required" }` — body kosong atau `message` undefined.
- `500` — kegagalan LLM (mis. timeout 60s).

**Example:**
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Apa prospek EURUSD minggu ini?"}'
```

---

## Backtesting

### Run

#### POST /api/backtest/run

Menjalankan backtest strategi pada data candle historis yang di-generate (~600 candle sesuai timeframe). Mendukung 4 strategi bawaan:

- `"EMA Crossover"` — entry saat EMA(9) cross EMA(21).
- `"Momentum Breakout"` — breakout 20-bar high/low (buffer 0.05%).
- `"Mean Reversion"` — deviasi ±0.2% dari rata-rata 20-bar.
- `"AI Hybrid"` — pseudo-blend berbasis cross EMA (placeholder).

Simulasi membatasi maksimal 3 posisi simultan, SL 8 pips, TP = SL × `rrRatio`, lot dihitung dari `(equity × riskPerTrade / 100) / (slPips × pipValue)`.

Setelah selesai, hasil disimpan ke tabel `Backtest` (termasuk equity curve JSON) dan sebuah log `INFO/BACKTEST` ditulis. `maxDuration = 60`.

**Request body:**
```typescript
interface RunBody {
  symbol: Pair;            // "EURUSD" | "USDJPY" | "GBPUSD" | "XAUUSD"
  timeframe: Timeframe;    // "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1"
  strategy: string;        // "EMA Crossover" | "Momentum Breakout" | "Mean Reversion" | "AI Hybrid"
  fromDate: string;        // ISO date "2024-05-01"
  toDate: string;          // ISO date "2024-06-01"
  initialCapital: number;  // e.g. 10000
  riskPerTrade: number;    // % e.g. 1
  rrRatio: number;         // e.g. 1.5
}
```

**Response:** `200 OK`
```json
{
  "backtest": {
    "id": "cuid111",
    "symbol": "EURUSD",
    "timeframe": "M15",
    "strategy": "EMA Crossover",
    "fromDate": "2024-05-01",
    "toDate": "2024-06-01",
    "initialCapital": 10000,
    "finalCapital": 10185.6,
    "totalTrades": 23,
    "wins": 10,
    "losses": 13,
    "winRate": 43.48,
    "profitFactor": 1.14,
    "maxDrawdown": 5.0,
    "netProfit": 185.6,
    "createdAt": "2024-06-10T10:00:00.000Z"
  },
  "equityCurve": [
    { "i": 0, "v": 10000 },
    { "i": 21, "v": 10050.5 },
    { "i": 599, "v": 10185.6 }
  ]
}
```

**Errors:**
- `400` — body JSON invalid atau `symbol` tidak ditemukan di `PAIRS` (akan `throw` di `PAIRS.find(...)!`).
- `500` — kegagalan database.

**Example:**
```bash
curl -X POST http://localhost:3000/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "timeframe": "M15",
    "strategy": "EMA Crossover",
    "fromDate": "2024-05-01",
    "toDate": "2024-06-01",
    "initialCapital": 10000,
    "riskPerTrade": 1,
    "rrRatio": 1.5
  }'
```

### List

#### GET /api/backtest/list

Mengembalikan hingga 50 riwayat backtest terbaru, diurutkan dari `createdAt` terbaru.

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "backtests": [
    {
      "id": "cuid111",
      "symbol": "EURUSD",
      "timeframe": "M15",
      "strategy": "EMA Crossover",
      "fromDate": "2024-05-01",
      "toDate": "2024-06-01",
      "initialCapital": 10000,
      "finalCapital": 10185.6,
      "totalTrades": 23,
      "wins": 10,
      "losses": 13,
      "winRate": 43.48,
      "profitFactor": 1.14,
      "maxDrawdown": 5.0,
      "netProfit": 185.6,
      "createdAt": "2024-06-10T10:00:00.000Z"
    }
  ]
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/backtest/list
```

---

## Alerts

### GET /api/alerts

Mengembalikan hingga 100 alert terbaru diurutkan dari `createdAt` terbaru.

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "alerts": [
    {
      "id": "cuid222",
      "type": "PRICE",
      "symbol": "EURUSD",
      "condition": "ABOVE",
      "price": 1.0900,
      "message": null,
      "email": null,
      "active": true,
      "triggered": false,
      "createdAt": "2024-06-10T10:00:00.000Z"
    }
  ]
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/alerts
```

### POST /api/alerts

Membuat alert baru. Field yang tidak diberikan diisi default (`type: "PRICE"`, `active: true`, dst.). Sebuah log `INFO/ALERT` ditulis.

**Request body:** `Partial<AlertRow>`.
```json
{
  "type": "PRICE",
  "symbol": "EURUSD",
  "condition": "ABOVE",
  "price": 1.0900
}
```

Untuk alert `EMAIL`:
```json
{ "type": "EMAIL", "email": "trader@finex.id", "message": "EURUSD breaks 1.09" }
```

Untuk alert `NEWS`:
```json
{ "type": "NEWS", "symbol": "EURUSD", "message": "Watch for FOMC minutes" }
```

**Response:** `200 OK`
```json
{ "ok": true, "id": "cuid222" }
```

**Errors:**
- `400` — body JSON invalid.

**Example:**
```bash
curl -X POST http://localhost:3000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{"type":"PRICE","symbol":"EURUSD","condition":"ABOVE","price":1.09}'
```

### DELETE /api/alerts

Menghapus alert berdasarkan `id`.

**Request body:**
```json
{ "id": "cuid222" }
```

**Response:** `200 OK`
```json
{ "ok": true }
```

**Errors:**
- `404` / `500` — jika `id` tidak ditemukan, Prisma akan melempar `P2025` (tidak ditangani eksplisit → Next.js akan mengembalikan 500 dengan pesan error Prisma).

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{"id":"cuid222"}'
```

---

## Logs

### GET /api/logs

Mengembalikan daftar log aktivitas sistem (trading, AI, MT5, risk guard, alert, backtest, terminal). Mendukung filter level dan batasan jumlah.

**Query parameters:**
- `level` (opsional) — `INFO` | `WARN` | `ERROR` | `TRADE` | `AI` | `ALL`. Jika `ALL` atau tidak diisi, semua level dikembalikan.
- `limit` (opsional) — integer. Default `200`, di-cap ke `500`.

**Request:**
```bash
curl "http://localhost:3000/api/logs?level=ERROR&limit=50"
```

**Response:** `200 OK`
```json
{
  "logs": [
    {
      "id": "cuid333",
      "level": "ERROR",
      "source": "MT5",
      "message": "Trade rejected: max open positions (3) reached",
      "meta": "{\"ticket\":\"806544\"}",
      "createdAt": "2024-06-10T10:00:00.000Z"
    }
  ]
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl "http://localhost:3000/api/logs?level=TRADE&limit=100"
```

---

## Indicators

### GET /api/indicators

Mengembalikan state 30 indikator scalping (dari `INDICATOR_POOL`). Pemanggilan pertama akan auto-seed tabel `IndicatorConfig` dengan default: indikator `EMA`, `RSI`, `ATR`, `Supertrend` di-enable; sisanya disabled. `autoMode = false` untuk semua.

**Request:** tidak ada.

**Response:** `200 OK`
```json
{
  "indicators": [
    {
      "name": "EMA",
      "enabled": true,
      "autoMode": false,
      "params": { "fast": 9, "slow": 21 },
      "category": "trend"
    },
    {
      "name": "RSI",
      "enabled": true,
      "autoMode": false,
      "params": { "period": 14, "ob": 70, "os": 30 },
      "category": "momentum"
    }
  ]
}
```

**Errors:** tidak ada.

**Example:**
```bash
curl http://localhost:3000/api/indicators
```

### PUT /api/indicators

Memperbarui satu indikator (enable/disable, autoMode, params). Menggunakan `upsert` berdasarkan `name` — jika indikator belum ada di DB, akan dibuat.

**Request body:** `IndicatorState` (lengkap).
```json
{
  "name": "EMA",
  "enabled": true,
  "autoMode": false,
  "params": { "fast": 12, "slow": 26 },
  "category": "trend"
}
```

**Response:** `200 OK`
```json
{ "ok": true }
```

**Errors:**
- `400` — body JSON invalid.

**Example:**
```bash
curl -X PUT http://localhost:3000/api/indicators \
  -H "Content-Type: application/json" \
  -d '{"name":"EMA","enabled":true,"autoMode":false,"params":{"fast":12,"slow":26},"category":"trend"}'
```

---

## Appendix — Type Definitions

Berikut adalah definisi tipe TypeScript lengkap yang dirujuk oleh seluruh endpoint di atas. Sumber: `src/lib/types.ts`.

### Primitif

```typescript
type Pair = "EURUSD" | "USDJPY" | "GBPUSD" | "XAUUSD";
type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
type Session = "Sydney" | "Tokyo" | "London" | "NewYork" | "LondonNewYork" | "NewYorkTokyo";
type Side = "BUY" | "SELL";
type SignalDirection = "BUY" | "SELL" | "NEUTRAL";
```

### Quote

```typescript
interface Quote {
  symbol: Pair;
  bid: number;
  ask: number;
  spreadPips: number;
  changePct: number;
  last: number;
  high: number;
  low: number;
  ts: number;
}
```

### AccountState

```typescript
interface AccountState {
  broker: string;
  login: string | null;
  server: string | null;
  leverage: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  mt5Connected: boolean;
  dailyLossUsed: number;
  dailyLossLimit: number;
}
```

### TradeRow

```typescript
interface TradeRow {
  id: string;
  ticket: string;
  symbol: Pair;
  side: Side;
  lotSize: number;
  openPrice: number;
  closePrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStop: boolean;
  trailingPips: number | null;
  slPips: number | null;
  tpPips: number | null;
  pnl: number;
  pips: number;
  status: "OPEN" | "CLOSED";
  source: "MANUAL" | "AI";
  strategy: string | null;
  openedAt: string;       // ISO date
  closedAt: string | null;
}
```

### RiskConfig

```typescript
interface RiskConfig {
  riskPerTrade: number;       // %
  stopLossPipsMin: number;
  stopLossPipsMax: number;
  rrRatio: number;
  maxOpenPositions: number;
  dailyLossLimit: number;     // %
  avoidHighImpactNews: boolean;
  dailyTarget: number;        // %
  autoMode: boolean;
}
```

### TradingConfig

```typescript
interface TradingConfig {
  pairs: Pair[];
  timeframes: Timeframe[];
  sessions: Session[];
  avoidWeekends: boolean;
  autoMode: boolean;
  trailingAuto: boolean;
  indicatorAuto: boolean;
  riskAuto: boolean;
}
```

### ApiKeys

```typescript
interface ApiKeys {
  groq: string;
  openai: string;
  together: string;
  tinyfish: string;
  finnhub: string;
  marketaux: string;
  activeProvider: "groq" | "openai" | "together" | "tinyfish" | "zai";
}
```

### AiAnalysisResult

```typescript
interface AiAnalysisResult {
  symbol: Pair;
  signal: SignalDirection;
  confidence: number;          // 0..100
  summary: string;
  factors: FactorScore[];
  suggestedEntry?: number;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
}

interface FactorScore {
  factor: string;
  direction: SignalDirection;
  score: number;               // -100..100
  detail: string;
}
```

### BacktestRow

```typescript
interface BacktestRow {
  id: string;
  symbol: Pair;
  timeframe: Timeframe;
  strategy: string;
  fromDate: string;
  toDate: string;
  initialCapital: number;
  finalCapital: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;             // %
  profitFactor: number;
  maxDrawdown: number;         // %
  netProfit: number;
  createdAt: string;
}
```

### AlertRow

```typescript
interface AlertRow {
  id: string;
  type: "PRICE" | "EMAIL" | "NEWS";
  symbol: string | null;
  condition: "ABOVE" | "BELOW" | null;
  price: number | null;
  message: string | null;
  email: string | null;
  active: boolean;
  triggered: boolean;
  createdAt: string;
}
```

### LogRow

```typescript
interface LogRow {
  id: string;
  level: "INFO" | "WARN" | "ERROR" | "TRADE" | "AI";
  source: string;
  message: string;
  meta?: string;
  createdAt: string;
}
```

### IndicatorState

```typescript
interface IndicatorState {
  name: string;
  enabled: boolean;
  autoMode: boolean;
  params: Record<string, number>;
  category: string;           // "trend" | "momentum" | "volatility" | "channel" | "volume"
}
```

### AiAnalysisRow (DB row)

```typescript
interface AiAnalysisRow {
  id: string;
  symbol: Pair;
  factors: string;            // JSON-stringified FactorScore[]
  summary: string;
  signal: SignalDirection;
  confidence: number;
  provider: string;           // "zai"
  createdAt: string;
}
```

## Catatan Implementasi

- **Database:** SQLite lokal via Prisma (`db/custom.db`). Tidak ada autentikasi multi-user — `ensureAccount()` selalu mengembalikan row Account tunggal.
- **AI provider default:** `zai` (Z.ai). Selalu tersedia tanpa konfigurasi tambahan. Provider lain (Groq, OpenAI, Together, Tinyfish) memerlukan API key yang disimpan via `PUT /api/config/keys`.
- **Mock market data:** Quote di-generate in-process oleh `@/lib/market` dan berubah pada setiap pemanggilan `getAllQuotes()`. Untuk integrasi produksi, ganti dengan feed broker real (mis. via MT5 bridge).
- **MT5 bridge:** Komponen Python terpisah yang berjalan di mesin Windows pengguna. Bridge membaca kredensial yang disimpan di DB (via endpoint Credentials/Connect) dan mengeksekusi `MetaTrader5.login()` / `MetaTrader5.initialize()` / `MetaTrader5.shutdown()`. Endpoint MT5 di dashboard hanya mengelola state koneksi dan kredensial — eksekusi trade sebenarnya dilakukan oleh bridge melalui library MT5.
- **Margin estimation:** `notional = lotSize × 100000 × openPrice`, `margin = notional / 500` (asumsi leverage 1:500). Pendekatan ini disederhanakan dan tidak memperhitungkan kontrak size per instrument atau margin requirement spesifik broker.
- **pipValue:** `$10` per pip per lot untuk pair USD-quoted FX, `$1` per pip per lot untuk `XAUUSD` (karena `pipSize = 0.1`).
