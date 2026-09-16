# Changelog

Semua perubahan signifikan didokumentasikan di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/); penomoran [SemVer](https://semver.org/lang/id/).

---

## [0.4.1] — 2026-09-16

### Added
- **Kunci AI kini diteruskan dashboard → Python engine** (menutup celah v0.4.0: input manual dashboard sebelumnya tidak pernah sampai ke engine). Saat mode engine LIVE, seluruh kredensial (DB terenkripsi → env dashboard) dikirim ke endpoint baru `PUT /api/v1/ai-keys` engine sebagai **runtime override di memori** (prioritas di atas `python-engine/.env`, tidak pernah ditulis ke disk/log, dilindungi guard `X-Engine-Key`).
- **Endpoint engine baru**: `GET /api/v1/ai-keys` (status sync tanpa secret — deteksi drift/restart), `PUT /api/v1/ai-keys` (terima payload kredensial, validasi ketat), `DELETE /api/v1/ai-keys` (kosongkan override).
- **Tombol *Sync ke Engine*** di kartu API Key Provider AI + status inline hasil sinkronisasi (berhasil/gagal + alasan ramah: mode demo, engine tidak terjangkau, dsb.).
- **Auto-sync**: setiap simpan/hapus kunci otomatis meneruskan ke engine; poll route melakukan resync berkala (maks 1×/5 menit, fire-and-forget) sehingga override pulih sendiri setelah engine restart.
- Resolusi engine menyatu: runtime (dashboard) → env engine → default; `get_provider_status()` engine kini melaporkan `source: runtime|env|none`.

### Changed
- Pesan error 401/403 & hint kunci engine kini menyebut kedua sumber (dashboard Settings / `.env` engine).
- Respons `PUT`/`DELETE /api/ai-providers` kini menyertakan field `engineSync` (hasil penerusan ke engine).

## [0.4.0] — 2026-09-16

### Added
- **Input manual API key per provider AI** (Settings → *API Key Provider AI*): kartu manajemen kredensial untuk seluruh 8 provider (Z.AI, Groq, Tinyfish, OpenAI, Google AI Studio, OpenRouter, Tokenplus, Local/Ollama) — input key masked dengan toggle lihat, override Base URL & model opsional, tombol **Simpan / Test koneksi / Hapus**, badge status (Key tersimpan · ENV · SDK bawaan · Belum diatur) + status test terakhir, pesan error ramah berbahasa Indonesia (401/403/404/429/5xx/timeout/koneksi).
- **Semua provider kini benar-benar live di dashboard** — sebelumnya hanya Z.AI (SDK) yang benar-benar memanggil LLM; 7 provider lain selalu fallback lokal. Route analisa kini dispatch lintas gaya API: OpenAI-compatible (zai-key/groq/tinyfish/openai/openrouter/tokenplus), Gemini REST (google), Ollama native (local), Z.AI SDK keyless (default). Endpoint & nama env identik dengan python-engine → perilaku dashboard ≡ engine.
- **Penyimpanan terenkripsi**: tabel `AiProviderCredential`, key di-encrypt **AES-256-GCM** (kunci scrypt dari `SESSION_SECRET`, format `v1:iv:tag:ct`, authenticated — tamper terdeteksi). Plaintext key tidak pernah dikirim balik ke client (hanya masked `gsk…abc4`), tidak pernah di-log.
- **API `/api/ai-providers`**: GET status (masked) · PUT simpan (validasi panjang key/URL/model; audit LogEntry SYSTEM) · POST test koneksi · DELETE hapus — semua di balik session gate + rate limit proxy.
- Prioritas resolusi kunci: **input manual DB → env var → SDK keyless (zai) → error ramah**; `.env.example` mendokumentasikan semua variabel fallback (nama identik engine).

### Security
- Kolom `AiProviderCredential.apiKeyEnc` terenkripsi at-rest; rotasi `SESSION_SECRET` meng-invalidate kredensial (by design).

## [0.3.3] — 2026-09-16

### Added
- **`.gitattributes`** — normalisasi line-ending lintas platform (`* text=auto`, script `.sh` dipaksa LF, binary ditandai). Mencegah `git pull` ditolak di Windows karena npm menulis-ulang `package.json` dengan CRLF ("Your local changes would be overwritten by merge").

## [0.3.2] — 2026-09-16

### Fixed
- **`npm run dev` / `build` / `start` gagal di Windows** — script lama memakai perintah khusus Unix (`tee`, `cp -r`, prefix `NODE_ENV=`) yang tidak ada di PowerShell/cmd. Ketiganya kini wrapper Node lintas platform `scripts/{dev,build,start}.mjs`: output tetap disalin ke `dev.log`/`server.log` (perilaku tee dipertahankan untuk monitoring), `NODE_ENV` di-set via env spawn, penghentian proses andal di Windows (`taskkill /T /F`), dan salin assets build memakai `fs.cpSync`.
- **Dockerfile**: tahap build di-inline langsung (`next build && cp -r …`) karena image `oven/bun` tidak memuat `node` — perilaku build Docker tidak berubah.
- **`.env.example`**: `DATABASE_URL` default kini path relatif lintas platform `file:../db/custom.db` (sebelumnya path absolut Linux sandbox `/home/z/...` yang tidak berlaku di Windows).
- **`db/.gitkeep`**: folder `db/` kini pasti ada pasca-clone (`prisma db push` tidak membuat folder induk).
- DEPLOYMENT.md: alur murni `npm`/Node untuk Windows didokumentasikan; prasyarat Node.js 18+ di PRODUCTION.md.

## [0.3.1] — 2026-09-16

### Fixed
- **`.env.example` tidak pernah masuk repo** — pola `.env*` pada `.gitignore` menelannya, padahal 9+ referensi di README/DEPLOYMENT/PRODUCTION/CONTRIBUTING/SECURITY memintanya (quick-start `cp .env.example .env` gagal bagi yang clone). Pola diganti `.env` + `.env.*` dengan pengecualian `!.env.example`; template lengkap kini ter-commit (semua key: DATABASE_URL, ADMIN_USERNAME/PASSWORD/PASSWORD_HASH, SESSION_SECRET, ENGINE_MODE/API_KEY, FINNHUB/MARKETAUX).
- `/api/health` membaca versi langsung dari `package.json` (sebelumnya fallback hardcoded yang mudah basi).

## [0.3.0] — 2026-09-16

### Added
- **Autentikasi dashboard**: login wajib (JWT HS256 cookie `finex_session` 7 hari), password scrypt (`bun run hash-password`), brute-force lockout 5×15 menit, audit log kategori `AUTH` di panel Logs, layar login + tombol logout di header.
- **Gerbang API** `src/proxy.ts`: seluruh `/api/*` wajib session (401) kecuali `/api/auth/*` & `/api/health`; rate limit per IP 240 GET / 60 write per menit (429).
- **Endpoint monitoring publik** `GET /api/health` (status/db/mode/uptime/version).
- **Hardening engine LIVE**: header `X-Engine-Key` (hmac konstan-waktu) untuk semua `/api/*` engine, CORS `allowed_origins` eksplisit (wildcard ditolak), `/health` publik; proxy dashboard mengirim kunci otomatis dari `ENGINE_API_KEY`.
- **Hardening Next.js**: security headers (X-Frame-Options DENY, CSP, nosniff, Referrer-Policy, Permissions-Policy), `poweredByHeader: false`, `robots.txt` Disallow-all, halaman `error.tsx` & `not-found.tsx`.
- **Database**: 5 index baru (Position, PriceAlert, Backtest, AnalysisRecord), SQLite **WAL mode** via instrumentation boot, logging Prisma error-only di produksi.
- **Artefak deployment**: Dockerfile multi-stage (bun build → node:22-alpine), docker-compose (healthcheck + volume), `.dockerignore`, `.env.example`, script `hash-password` & `db:backup`, PRODUCTION.md (runbook 12 section).
- **Dokumentasi lengkap**: README, ARCHITECTURE, API, DEPLOYMENT, SECURITY, CONTRIBUTING, CHANGELOG.
- Kategori `AUTH` pada filter panel Logs.

### Security
- Build produksi kini fail-fast (`ignoreBuildErrors: false`; tsconfig exclude folder environment).
- Guard traversal `/api/engine/file` dihardening (path.relative + separator).
- `.gitignore`: file WAL/SHM SQLite; `core.fileMode false` (noise chmod daemon snapshot).

## [0.2.1] — 2026-09-16

### Fixed
- **Margin quote-currency** keliru arah konversi (JPY/CHF/GBP/AUD/CAD-quoted cross ter-oversize hingga ~154×) — helper `quoteToUsd` di 4 situs (stop-out, AI lot maks, order open, ringkasan akun); order risk-based cross kini dapat dieksekusi.
- Koneksi Prisma read-only pasca git-checkout (inode DB berganti) — pemulihan + prosedur.

### Added (audit integrasi — 12 gap)
- Berita real auto **pair-tagging + sentimen + dampak** (heuristik keyword dua sisi TS & Python); URL Marketaux engine dikoreksi.
- Sentimen analisa **per-pair** (prioritas berita ber-tag pair).
- Sumber learning baru **ANALYSIS**: "Trade dari sinyal" ikut melatih ModelStat (`signalIndicators` di-persist).
- Notifikasi `daily_report` di demo (daily roll runtime + boot-time).
- Kalender ekonomi **8 mata uang** (+AUD/CAD/CHF/NZD; 33 template).
- CLI backtest engine: `python main.py --backtest PAIR TF [--bars N]`.
- Konteks fundamental 18/18 pair; hook `symbols` berita engine; wording akurat setup-panel; ZIP engine bersih dari `data/`.

## [0.2.0] — 2026-09-15

### Added
- **18 pair** (from 6): +EURJPY, EURGBP, EURCHF, EURAUD, GBPJPY, GBPCHF, AUDJPY, CADJPY, CHFJPY, NZDUSD, XAGUSD — konsisten lintas TS + Python + simulator.
- **Analisa multi-pair**: radio "Semua pair aktif" + per-pair, batch run dengan progress, grid hasil + detail.
- **3 mode kepadatan UI** (Compact/Dense/Minimal) via `data-density` + persist localStorage tanpa flash.
- Watchlist Overview 18 pair; tombol pair → chart Trading.

## [0.1.0] — 2026-09-14

### Added
- Rilis awal: dashboard Next.js 16 (9 panel), simulator DEMO penuh (spread/commission/slippage/volatilitas sesi), trading manual + AI auto-trading, analisa hybrid LLM (8 provider, ZAI default) + 30 indikator + 13 kategori fundamental, risk engine (0,5–1%/trade, daily limit, stop-out), self-learning ModelStat, backtest, berita Finnhub/Marketaux + simulasi, alerts harga, notifikasi email (simulasi), engine LIVE Python/FastAPI/MT5 (5 thread daemon, kontrak `/api/v1/poll`), dark/light theme.
