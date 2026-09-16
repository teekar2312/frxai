# Referensi API — FINEX AI Trading System

Semua endpoint dashboard berada di bawah route yang sama dengan UI (`/api/...`). Endpoint engine LIVE berjalan di Python engine (`http://<engine>:8000`).

---

## 1. Autentikasi & Batasan

### 1.1 Session

| Item | Nilai |
|---|---|
| Metode | Cookie `finex_session` — JWT HS256, HttpOnly, SameSite=Lax, `secure` otomatis di HTTPS |
| Masa berlaku | 7 hari |
| Login | `POST /api/auth/login` dengan kredensial admin (`ADMIN_PASSWORD_HASH` scrypt / `ADMIN_PASSWORD` / default first-run) |

### 1.2 Gerbang API (`src/proxy.ts`)

- **Seluruh `/api/*` wajib session valid**, kecuali: `/api/auth/*` dan `/api/health`.
- Tanpa session → `401`:

```json
{ "success": false, "error": "UNAUTHORIZED", "message": "Sesi tidak valid atau belum login." }
```

### 1.3 Rate limit (per IP)

| Jenis | Batas | Pelanggaran |
|---|---|---|
| GET/HEAD | 240 req/menit | `429` + header `Retry-After` |
| POST/PUT/PATCH/DELETE | 60 req/menit | `429` |
| Login gagal | 5× per 15 menit | IP terkunci 15 menit (`429`) |

### 1.4 Format error standar

```json
{ "error": "deskripsi singkat (ID)" }
```
Kode: `400` input tidak valid · `401` belum login · `404` tidak ditemukan · `405` method salah · `429` rate limit · `500` error server.

---

## 2. Autentikasi

### POST /api/auth/login *(publik)*
```json
// body
{ "username": "admin", "password": "••••••••" }
// 200
{ "success": true, "username": "admin" }
// 401
{ "success": false, "error": "INVALID_CREDENTIALS", "message": "Username atau password salah. Sisa 3 percobaan." }
```
Sukses → set cookie session. Kejadian login (sukses/gagal) tercatat di LogEntry kategori `AUTH`.

### POST /api/auth/logout *(publik)*
Hapus cookie session. Selalu `200 { "success": true }` (aman dipanggil walau session expired).

### GET /api/auth/session *(publik)*
```json
{ "authenticated": true, "username": "admin", "expiresAt": 1762300000 }
```

### GET /api/health *(publik — monitoring)*
```json
{ "status": "ok", "db": "ok", "mode": "demo", "uptime": 5496,
  "version": "0.3.0", "timestamp": "…", "latencyMs": 5 }
```
`503` bila database tidak merespons. Tidak membocorkan data trading.

---

## 3. Engine & Pasar

### GET /api/engine
Payload poll utama (dipanggil header tiap 2s): `status` (mode, connected, aiTrading), `account` (balance, equity, margin, floatingPnl, dailyPnlPct, …), `prices` (map pair → bid/ask/spread/pct), `openPositions`. Mode LIVE → proxy ke engine Python + header `X-Engine-Key`; engine tak terjangkau → fallback demo dengan `connected=false`.

### GET /api/market/history?pair=EURUSD&tf=M15&limit=200
Array candle `{time, open, high, low, close}` (urut lama→baru). Validasi pair/TF → `400` dengan daftar nilai valid bila salah. Timeframe tipis (H4+) otomatis disintesis deterministik (seeded per pair+tf).

### GET /api/engine/files *(Setup panel)*
Daftar file engine untuk viewer.

### GET /api/engine/file?path=app/mt5_client.py
Isi file teks engine (hanya di dalam `python-engine/`, dilindungi guard traversal — `../db/custom.db` → `400`).

### GET /api/engine/download
ZIP seluruh `python-engine/` (tanpa `data/` runtime) untuk di-download user ke PC Windows.

---

## 4. Trading

### POST /api/orders
Satu endpoint, empat aksi:

```jsonc
{ "action": "open", "pair": "EURUSD", "side": "BUY",
  "volume": 0.10 }                       // lot eksplisit
{ "action": "open", "pair": "CADJPY", "side": "SELL",
  "riskBased": true,                      // lot dihitung dari risk% & SL
  "stopLossPips": 15, "takeProfitPips": 22 }
{ "action": "close", "positionId": "cmu…" }
{ "action": "closeAll" }
{ "action": "modify", "positionId": "cmu…",
  "stopLoss": 1.0800, "takeProfit": 1.0950, "trailing": true }
```
Respon `200` berisi posisi/akun terbaru. Guard yang dapat menolak (`400`/`409` dengan pesan): pair tidak dikenal, margin tidak cukup (dihitung dengan konversi quote-currency ke USD), melebihi max positions, daily loss limit tercapai, stop-out.

### GET /api/positions
Daftar posisi OPEN (live PnL per tick).

### GET /api/positions/history?limit=50
Riwayat posisi CLOSED (sumber: MANUAL/AI/ANALYSIS).

---

## 5. Analisa AI

### POST /api/analysis
```json
// body
{ "pair": "GBPJPY", "timeframe": "M15" }   // timeframe opsional (default H1)
```
Menjalankan analisa hybrid: 30 indikator + 13 kategori fundamental + sentimen berita pair-tagged → provider LLM (ZAI default) → hasil terstruktur:
```jsonc
{ "signal": "SELL", "confidence": 0.72,
  "entry": 189.42, "stopLoss": 189.80, "takeProfit": 188.65,
  "reasoning": "…", "fundamentals": {…}, "indicators": {…},
  "newsSentiment": -0.15, "provider": "zai", "source": "LLM Live" }
```
Cache 30 detik per pair+tf. Provider gagal → fallback heuristik voting indikator berbobot self-learning (`source: "Heuristic"`). Dipersist ke `AnalysisRecord`.

### GET /api/analysis/history?pair=&limit=
Riwayat analisa tersimpan.

### GET /api/model
Statistik self-learning: bobot + win/loss per indikator (dipakai panel Overview & Settings).

---

## 6. Berita & Kalender

### GET /api/news
Feed berita terbaru (DB, tanpa fetch ulang).

### POST /api/news
```json
{ "action": "fetch-real" }   // tarik Finnhub + Marketaux (perlu API key env)
{ "action": "generate" }     // buat 2-3 berita SIM (tanpa API key)
```
Berita real otomatis di-tag pair + sentimen + dampak (heuristik keyword dua sisi TS/Python).

### GET /api/calendar
Kalender ekonomi 8 mata uang (USD/EUR/GBP/JPY/AUD/CAD/CHF/NZD) — event rate decision CPI, employment, dll.

---

## 7. Alerts, Backtest, Settings, Logs, Notifikasi

### GET /api/alerts · POST /api/alerts
```json
// POST
{ "pair": "CHFJPY", "condition": "ABOVE", "price": 175.5, "note": "breakout watch" }
```
### PATCH /api/alerts/[id] · DELETE /api/alerts/[id]
`PATCH { "status": "CANCELLED" }` untuk batalkan.

### GET /api/backtest · POST /api/backtest
```json
// POST — jalankan backtest
{ "pair": "GBPCHF", "timeframe": "H1", "bars": 1000,
  "riskPerTrade": 0.75, "stopLossPips": 10, "takeProfitRatio": 1.5 }
```
Hasil: winRate, profitFactor, maxDrawdown, expectancy, sharpe, equityCurve, daftar trade. GET → riwayat backtest.

### GET /api/settings · PUT /api/settings
`PUT` menerima **partial merge** (field absen dipertahankan). Validasi: array seleksi (pairs/sessions/timeframes/indicators) minimal 1 item; risk clamp 0.5–1%; daily limit 2–3%. Contoh:
```json
{ "pairs": ["EURUSD","USDJPY"], "tradingMode": "ai", "riskPerTrade": 0.5 }
```

### GET /api/logs?level=WARN&category=AUTH&q=login&limit=100
Filter level/kategori/teks, limit 1–500. `DELETE` → bersihkan log.

### POST /api/notify
```json
{ "action": "test", "event": "trade_open" }   // kirim email test (butuh emailEnabled)
```

---

## 8. Python Engine (LIVE) — `http://<engine-host>:8000`

**Autentikasi**: seluruh `/api/*` wajib header `X-Engine-Key: <api_key>` (dari `config.yaml` / env `ENGINE_API_KEY`) → selain itu `401 {"detail":"invalid or missing engine key"}`. `/health` publik.

| Endpoint | Metode | Fungsi |
|---|---|---|
| `/` | GET | Info engine (versi, uptime) |
| `/health` | GET | Health publik `{status, version, uptime_s}` |
| `/api/v1/poll` | GET | **Kontrak utama** — status/akun/harga/posisi dari cache (dipanggil `/api/engine` dashboard) |
| `/api/v1/health` | GET | Detail kesehatan MT5 |
| `/api/v1/positions` | GET | Posisi MT5 terkini |
| `/api/v1/history?pair=&tf=&bars=` | GET | Candle riil dari MT5 |
| `/api/v1/candles?pair=&tf=&limit=` | GET | Alias candle |
| `/api/v1/news` | GET | Cache berita engine |
| `/api/v1/calendar` | GET | Kalender ekonomi engine |
| `/api/v1/settings` | GET | Baca konfigurasi (api_key tidak pernah dikembalikan) |
| `/api/v1/settings` | POST | Write-back settings dari dashboard |
| `/api/v1/orders` | POST | Eksekusi order (open/close/modify) |
| `/api/v1/alerts` | POST | Sinkron alert ke engine |

**CORS**: hanya origin terdaftar (`allowed_origins`, default `http://localhost:3000`) — wildcard ditolak.

## 9. Konvensi Umum

- Semua endpoint `force-dynamic` (tanpa cache Next).
- Timestamp ISO-8601 UTC; angka harga tanpa format (string dihindari).
- Harga/PnL di client dirender font-mono tabular.
- Pesan error **Bahasa Indonesia**, dipamerkan apa adanya oleh toast panel.
