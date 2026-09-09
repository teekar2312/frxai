# Changelog — FXQuant AI

Semua perubahan penting pada proyek ini akan didokumentasikan di file ini.

Format berdasarkan [Keep a Changelog](https://keepachangelog.com/id/1.0.0/), dan proyek ini mengikuti [Semantic Versioning](https://semver.org/lang/id/).

---

## [Unreleased]

### Planned
- WebSocket untuk push real-time (menggantikan polling)
- Multi-user support dengan NextAuth.js
- Kalender ekonomi terintegrasi (Finnhub / Marketaux)
- Mobile app (React Native)

---

## [1.1.0] — 2025-09-09

### Added — AI Auto-Trading (full implementation)

Setelah audit mendalam, semua fitur "auto" yang sebelumnya hanya UI shell kini berfungsi penuh:

#### Signal → Trade Auto-Execution
- `/api/ai/signal` sekarang mengkonversi sinyal kuat (confidence ≥ 55%, non-NEUTRAL) langsung menjadi OPEN Trade (source="AI") — bukan lagi sekadar PENDING row
- Signal ditandai `EXECUTED` saat trade dibuat, `SKIPPED` jika ditolak (max positions / daily limit)
- Shared helper `executeSignalAsTrade()` di `src/lib/auto-trade.ts` dipakai oleh both manual "Eksekusi Sinyal" dan background auto-trade
- Lot size dihitung otomatis dari RiskConfig (risk% × balance ÷ SL pips × pipValue)

#### Auto-Trade Scheduler (Phase 2)
- Endpoint baru `POST /api/auto-trade/tick` — satu cycle: analyze 1 pair (round-robin) + execute jika sinyal kuat + trailing pass + indicator auto-select + risk auto-adjust + signal expiry
- Browser scheduler di `trading-shell.tsx`: saat `autoMode=true`, fire `/api/auto-trade/tick` setiap 90 detik
- Round-robin: pair dengan analisa tertua dipilih dulu (distribusi merata)
- Toast notification muncul saat AI trade dieksekusi otomatis

#### Trailing Stop Otomatis (Phase 3)
- Endpoint baru `POST /api/trade/trail` — untuk setiap OPEN trade dengan `trailingStop=true`, geser SL toward current price (ratchet: hanya bergerak ke arah menguntungkan)
- Browser poller: setiap 5 detik saat ada open trades, jalankan trailing pass
- AI trades otomatis dapat `trailingStop=true` + `trailingPips=SL pips` saat `tradingCfg.trailingAuto=true`
- BUY: `newSL = max(currentSL, currentBid - trailDist)`; SELL: `newSL = min(currentSL, currentAsk + trailDist)`

#### Weekend & Session Gate (Phase 4)
- `POST /api/trade/place` sekarang menolak order saat weekend (jika `avoidWeekends=true`) atau di luar sesi terkonfigurasi
- Auto-trade tick juga memeriksa gate yang sama sebelum analyze+execute
- Error messages jelas: "Trading dihentikan pada hari Sabtu & Minggu" / "Di luar sesi trading terkonfigurasi"

#### AI Auto-Select Indicators (Phase 4)
- Saat `indicatorAuto=true`, tick otomatis mengaktifkan 5 indikator scalping optimal (EMA, RSI, ATR, Supertrend, Bollinger Bands) dan menonaktifkan sisanya
- Per-indicator `autoMode=true` ditandai saat auto-select berjalan

#### AI Auto-Adjust Risk (Phase 4)
- Saat `riskAuto=true`, tick mengevaluasi 5 trade closed terakhir
- 3+ loss beruntun → turunkan `riskPerTrade` 50% (min 0.5%)
- Win streak → naikkan `riskPerTrade` +0.1% (max 1%)
- Perubahan disimpan ke DB via `setConfig("risk", ...)`

#### Signal Lifecycle (Phase 5)
- `expireOldSignals()`: PENDING signals >30 menit ditandai `EXPIRED` (dijalankan setiap tick)
- Endpoint baru `GET /api/ai/signals?status=PENDING&limit=50` — list signals dengan filter status
- Signal status lifecycle kini lengkap: PENDING → EXECUTED / SKIPPED / EXPIRED

#### Real MT5 Prices (Phase 6)
- Module `src/lib/market-cache.ts` — in-memory cache untuk tick real dari bridge
- Endpoint baru `POST /api/market/ticks` — bridge POST tick real setiap detik
- `GET /api/market` sekarang prefer real MT5 ticks (jika tersedia & fresh <15s), fallback ke simulator
- Bridge `mt5_bridge.py` updated: `publish_ticks()` membaca `symbol_info_tick()` untuk 4 pair, POST ke dashboard
- Response field `source: "mt5" | "simulator"` menandakan asal data

#### Auto-Trade Status API
- Endpoint baru `GET /api/auto-trade/status` — returns autoMode, trailingAuto, indicatorAuto, riskAuto, isWeekend, inConfiguredSession, canTrade, recentAiTrades, signal counts (pending/executed/skipped/expired), lastAnalysisAt

#### UI Improvements
- Top-bar "AI Auto" switch sekarang persist ke backend (`PUT /api/config/trading`) — tidak lagi reset pada reload
- Toggle ON: toast "AI Auto-Trade AKTIF" dengan deskripsi scheduler
- Toggle OFF: toast "AI Auto-Trade OFF"
- "Eksekusi Sinyal" button sekarang benar-benar place trade — toast menampilkan detail trade (side, symbol, lot, SL, TP)
- Trade muncul di tabel posisi otomatis via `upsertTrade()`

### Changed
- `src/lib/auto-trade.ts` (NEW) — shared auto-trade logic: `executeSignalAsTrade()`, `runAutoTradeCycle()`, `runTrailingStopPass()`, `autoSelectIndicators()`, `autoAdjustRisk()`, `expireOldSignals()`
- `src/app/api/ai/signal/route.ts` — refactored to use shared helper, auto-execute trades
- `src/app/api/trade/place/route.ts` — added weekend + session gate
- `src/app/api/market/route.ts` — prefer real MT5 ticks over simulator
- `bridge/mt5_bridge.py` — added `publish_ticks()` in main loop
- Top-bar switch wired to `toggleAutoMode()` (persist + toast)

### Fixed (from audit)
- **Dead flag → live**: `tradingCfg.autoMode` sekarang benar-benar memulai scheduler (sebelumnya: tidak ada efek)
- **Dead flag → live**: `tradingCfg.trailingAuto` sekarang mengaktifkan trailing stop pada AI trades + poller berjalan
- **Dead flag → live**: `tradingCfg.indicatorAuto` sekarang auto-select 5 indikator scalping
- **Dead flag → live**: `tradingCfg.riskAuto` sekarang auto-adjust riskPerTrade berdasarkan performa
- **Dead flag → live**: `tradingCfg.avoidWeekends` sekarang gate manual + auto trades
- **Dead flag → live**: `tradingCfg.sessions` sekarang gate manual + auto trades
- **Dead flag → live**: `Trade.trailingStop`/`trailingPips` sekarang benar-benar menggerakkan SL
- **Signal lifecycle**: PENDING signals sekarang → EXECUTED/SKIPPED/EXPIRED (sebelumnya: write-only, tidak pernah dibaca)
- **Top-bar switch persistence**: sekarang PUT ke backend (sebelumnya: hanya client state, reset pada reload)

---

## [1.0.0] — 2025-09-09
- Dashboard analytics lanjutan (Sharpe ratio, max consecutive losses)

---

## [1.0.0] — 2025-09-09

### Added — Fitur Utama

#### Dashboard & UI
- Dashboard operasional dengan stat cards (balance, equity, free margin, day P&L)
- Equity curve chart (Recharts AreaChart, emerald gradient)
- Market watch panel untuk 4 pair (EURUSD, USDJPY, GBPUSD, XAUUSD) dengan live bid/ask/spread
- Sesi trading aktif indicator (Sydney, Tokyo, London, New York, overlap)
- Posisi terbuka table dengan P&L live
- Aktivitas terbaru timeline (log feed)
- Dark trading terminal theme (default) + light mode toggle
- Sticky footer dengan risk warning
- Responsive: mobile (390px) sampai desktop (1440px+)

#### AI Analysis Center
- Analisa multi-faktor menggunakan real LLM (z-ai-web-dev-sdk)
- 7 faktor dianalisa: kebijakan bank sentral, data ekonomi, geopolitik, fiskal, komoditas, sentimen, breaking news
- Tombol "Analisa Semua Pair" — analisa paralel semua pair aktif
- Pair summary grid (klikable cards dengan signal + confidence)
- Detail panel: signal banner, confidence progress bar, summary, Entry/SL/TP, heatmap 7 faktor
- Eksekusi sinyal (generate trade signal dari AI analysis)
- Chat AI interface
- Self-learning memory (semua analisa disimpan ke DB)
- Multi-provider support: Z.ai (default), Groq, OpenAI, Together.ai, Tinyfish.ai

#### Trading Terminal
- Order manual form (symbol, side BUY/SELL, lot, SL pips, TP pips, trailing stop)
- Real-time risk calculation (Risk$, Reward$, R:R ratio)
- AI auto-trade toggle
- Open & closed positions table (13 columns, live P&L)
- Close position per row
- Trailing stop otomatis toggle
- Margin usage indicator (open positions / max, margin level, MC/Stop Out reference)

#### Indicators Lab
- 30 indikator pool terdokumentasi (8 trend, 9 momentum, 5 volatility, 2 channel, 5 volume)
- Enable/disable per indikator
- Editable parameters (numeric inputs)
- AI auto-select toggle
- Category filter (All, Trend, Momentum, Volatility, Channel, Volume)
- Scalping hint per indikator
- Summary: enabled count per category

#### Risk Management
- Risk per trade slider (0.5–2%)
- Stop loss range (min/max pips)
- Risk:Reward ratio slider (1.0–3.0)
- Max open positions slider (1–10)
- Daily loss limit (Anti-MC) slider (1–5%)
- Daily target slider (1–5%)
- Avoid high-impact news toggle
- AI auto risk toggle
- Kalkulator lot size (balance, pair, risk%, SL → lot, risk$, potential profit)
- Anti-MC progress bar (daily loss used vs limit)
- FINEX broker spec reference card

#### Backtesting
- 4 strategi: EMA Crossover, Momentum Breakout, Mean Reversion, AI Hybrid
- Konfigurasi: symbol, timeframe, date range, initial capital, risk%, R:R
- Hasil: 6 stat cards (net profit, win rate, profit factor, total trades, max drawdown, final capital)
- Equity curve chart dari hasil backtest
- Riwayat backtest table (tersimpan di DB)

#### Alerts & Notifications
- Alert harga (ABOVE/BELOW dengan target price)
- Alert email (notifikasi via SMTP bridge)
- Alert berita dadakan (news keywords)
- Active alerts list dengan enable/disable & delete

#### System Logs
- Log levels: INFO, WARN, ERROR, TRADE, AI
- Filter by level (toggle group)
- Search by message text
- Stat cards (total, errors, trades, AI logs)
- Terminal-style log list (max-h scroll, colored levels)
- 300 entries loaded, 500 in memory

#### Settings
- **Trading tab:** multi-select pairs, timeframes, sessions; avoid weekends toggle; auto-mode switches (trailing, indicator, risk)
- **AI Provider tab:** active provider radio; API key inputs (Groq, OpenAI, Together, Tinyfish, Finnhub, Marketaux) dengan masking; save button
- **Broker / MT5 tab:** FINEX spec grid; MT5 credentials form (account number, password with show/hide, server, demo/real type, terminal); MT5 terminal launcher panel (path input, auto-start toggle, start/stop buttons, status display); connect/disconnect flow
- **Risiko tab:** read-only risk config summary + shortcut ke Risk Management

#### MT5 Integration
- POST /api/mt5/connect — validasi & simpan kredensial, auto-launch terminal
- GET/PUT /api/mt5/credentials — manage credentials (password di-mask di GET)
- POST /api/mt5/disconnect — putuskan bridge, simpan kredensial
- POST /api/mt5/start-terminal — launch terminal64.exe
- POST /api/mt5/stop-terminal — hentikan terminal + disconnect
- GET /api/mt5/terminal-status — cek running/PID/path/autoStart

#### Backend API (25 endpoints)
- Market data, configuration (account/trading/risk/keys), MT5 bridge (6 endpoints), trading (place/close/list), AI (analyze/signal/chat), backtest (run/list), alerts, logs, indicators
- Semua force-dynamic, AI & backtest maxDuration=60s
- Server-side validation (account number 4-12 digit, password min 4 char, max positions, daily loss limit)
- Prisma ORM + SQLite (9 models: Account, Trade, Configuration, IndicatorConfig, Alert, Log, Backtest, AiAnalysis, Signal)

### Security
- `.env` dan `db/custom.db` di-gitignore (tidak pernah di-commit)
- API keys di-mask di UI
- z-ai-web-dev-sdk server-only (import "server-only")
- MT5 credentials disimpan lokal, password di-mask
- GitHub Push Protection: history rewritten untuk purge db/custom.db (berisi Groq API key) dari semua commit

### Documentation
- README.md — overview, fitur, tech stack, setup, usage
- docs/ARCHITECTURE.md — arsitektur sistem, alur data, keputusan desain
- docs/API.md — referensi 25 endpoint API
- docs/MT5-BRIDGE.md — panduan setup Python bridge di Windows 11 (dengan script lengkap)
- docs/INDICATORS.md — dokumentasi 30 indikator + strategi scalping
- docs/RISK-MANAGEMENT.md — aturan money management + kalkulator lot
- CONTRIBUTING.md — panduan kontribusi
- .env.example — template environment variables

### Tech Stack
- Next.js 16 (App Router) + TypeScript 5
- Tailwind CSS 4 + shadcn/ui (New York)
- Prisma 6 + SQLite
- Zustand 5 (client state)
- Recharts 2 (charts)
- Framer Motion 12 (animasi)
- Sonner (toasts)
- next-themes (dark/light)
- z-ai-web-dev-sdk (AI engine, server-only)
- Bun (runtime)

---

## Versioning

- **Major (X.0.0):** Breaking changes (API tidak kompatibel, schema DB berubah)
- **Minor (1.X.0):** Fitur baru backward-compatible
- **Patch (1.0.X):** Bug fixes, improvement kecil

---

## Links

- [Releases](https://github.com/teekar2312/frxai/releases)
- [Commits](https://github.com/teekar2312/frxai/commits/main)
- [Issues](https://github.com/teekar2312/frxai/issues)
