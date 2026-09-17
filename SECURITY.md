# Keamanan — FINEX AI Trading System

Dokumen ini memetakan model ancaman, lapisan pertahanan yang diimplementasikan, batasan yang diketahui, dan prosedur insiden.

---

## 1. Model Ancaman

Sistem ini menangani **akun trading dana riil**, sehingga aset yang dilindungi:

1. **Kredensial & akses dashboard** (eksekusi order = perpindahan uang).
2. **Data akun & posisi** (equity, floating PnL, riwayat).
3. **Kontrol engine LIVE** (endpoint order di PC user).
4. **Data pribadi** (email notifikasi, IP di audit log).
5. **Kredensial repo/deploy** (PAT, API key, secret).

Aktor: penyerang internet (dashboard publik), pihak di jaringan yang sama (engine), script kiddie brute-force, dan **kesalahan operator sendiri** (mis. secret ter-commit).

## 2. Lapisan Pertahanan

### 2.1 Autentikasi dashboard

| Kontrol | Implementasi |
|---|---|
| Session | JWT HS256 (`jose`) cookie `finex_session` — HttpOnly, SameSite=Lax, Secure di HTTPS, exp 7 hari |
| Signing key | `SESSION_SECRET` (min 32 char; error eksplisit bila kurang) — rotasi = seluruh session invalid |
| Password produksi | scrypt `N=16384,r=8,p=1,keylen=64`, salt 16-byte — format `scrypt:…` di `ADMIN_PASSWORD_HASH`; generator `bun run hash-password` |
| Perbandingan | `crypto.timingSafeEqual` via digest sha256 (anti timing attack) di username & password |
| Brute-force | 5 kegagalan/IP/15 menit → lockout 15 menit (password benar pun ditolak selama lockout) |
| Audit | Setiap login sukses/gagal + logout → `LogEntry` kategori `AUTH` (terlihat di panel Logs) |
| Default first-run | `finex-admin-2025` hanya aktif bila env kosong, **hint amber tampil di layar login** sebagai peringatan |

### 2.2 Gerbang API (`src/proxy.ts`)

- Default-deny: **seluruh** `/api/*` → 401 kecuali whitelist `/api/auth/*`, `/api/health`.
- Rate limit per IP: 240 GET/mnt, 60 write/mnt → 429 + `Retry-After` (prune bucket >5000).
- Identitas user diteruskan via header internal `x-user`.

### 2.3 Engine LIVE (Python)

| Kontrol | Implementasi |
|---|---|
| API key | Header `X-Engine-Key` wajib untuk semua `/api/*`; `hmac.compare_digest` (konstan-waktu) |
| CORS | `allowed_origins` eksplisit; wildcard `*` **ditolak** oleh validator |
| Health publik | `/health` di luar prefix `/api/` — tanpa data sensitif |
| Traversal | `/api/engine/file?path=` → resolusi `path.relative` + cek separator (`../` → 400) |
| Kebocoran config | `to_dict()` engine **membuang** `api_key`; ZIP download mengecualikan `data/` runtime |
| Warning | Startup mencatat warning bila `api_key` kosong (mode terbuka) |

**Panduan eksposur**: bind `127.0.0.1` (terbaik) → Cloudflare Tunnel/Tailscale (disarankan) → LAN dengan key kuat. **Port-forward publik dilarang.**

### 2.4 HTTP & aplikasi

- Header keamanan (next.config.ts): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (kamera/mic/geo/payment/usb ditolak), CSP (`default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, connect dibatasi self+ws).
- `poweredByHeader: false` — tidak membocorkan teknologi.
- `robots.txt` → `Disallow: /` (dashboard privat, tidak diindeks).
- Build produksi `ignoreBuildErrors: false` — error TS = build gagal (regresi terlihat).
- Validasi input di semua route: pair/TF/side/action diverifikasi terhadap daftar known-values (`400` + pesan Indonesia), panjang string dibatasi, body JSON di-parse aman.

### 2.5 Data & keamanan trading

- **SQLite WAL**: integritas saat crash + pembaca non-blocking.
- DB & WAL/SHM di-`.gitignore` (tidak pernah ter-commit).
- `.env` di-`.gitignore`; template `.env.example` tanpa nilai rahasia.
- Guard risiko dijalankan **server-side** (bukan bisa dilewati dari client): margin (konversi quote→USD), max positions, daily loss limit, stop-out enforcement.

### 2.6 Kebersihan secret di repo

- Historis: satu PAT sempat terekspos di kanal chat — **wajib revoke**; audit `rg ghp_` per dilakukan berkala.
- Kredensial sandbox (`ADMIN_PASSWORD`, `SESSION_SECRET`, `ENGINE_API_KEY`) hanya di `.env` lokal, tidak pernah di-commit.
- **API key provider AI** (input manual Settings): tersimpan **terenkripsi AES-256-GCM** di kolom `AiProviderCredential.apiKeyEnc` (kunci scrypt dari `SESSION_SECRET`); plaintext tidak pernah dikirim balik ke client (hanya masked `gsk…abc4`), tidak pernah di-log, dan endpoint manajemennya di balik session gate + rate limit. Rotasi `SESSION_SECRET` meng-invalidate kredensial tersimpan (input ulang setelah rotasi). Backup DB berisi ciphertext — simpan `SESSION_SECRET` terpisah dari file backup.
- **Penerusan kunci dashboard → engine** (`PUT /api/v1/ai-keys`, mode LIVE): payload berisi plaintext key dan HANYA dikirim ke `engineUrl` yang dikonfigurasi, dilindungi guard `X-Engine-Key` (wajib sama dengan `ENGINE_API_KEY` kedua sisi). Di engine, override hanya hidup **di memori** — tidak pernah ditulis ke disk/log (log hanya id provider); restart engine menghapusnya (auto-resync dashboard 1×/5 menit memulihkan). **Wajib HTTPS/tunnel** untuk lintas jaringan (lihat PRODUCTION.md §keamanan jaringan engine); koneksi plain-HTTP hanya untuk localhost/uji. `GET /api/v1/ai-keys` hanya mengekspos `hasKey` boolean + baseUrl/model — tanpa nilai kunci.
- **Backup secret `db/.session-secret`** (v0.4.2): salinan `SESSION_SECRET` untuk self-heal `.env` oleh `scripts/lib/ensure-env.mjs` (insiden daemon sandbox memotong `.env` berulang kali). File mode `600`, di-gitignore, berisi nilai yang sama dengan `.env` — **lindungi akses filesystem ke folder `db/` seketat `.env`** (pembaca file ini dapat menandatangani session sendiri). Bila menghendaki rotasi manual: hapus `db/.session-secret` DAN ganti `SESSION_SECRET` di `.env` bersamaan, lalu restart (kredensial AI tersimpan perlu diinput ulang — by design).
- **Fallback raw SQL kredensial** (v0.4.2, `src/lib/ai-provider-credential-db.ts`): seluruh nilai di-bind sebagai parameter SQL (`?`) — tidak ada interpolasi string nilai user ke statement; nama kolom berasal dari kode, bukan input. Jalur ini hanya aktif bila aksesor model Prisma tidak tersedia di runtime (client stale) atau gagal — data tetap ciphertext AES-256-GCM, tidak ada perubahan model ancaman.

## 3. Batasan yang Diketahui (trade-off)

| Batasan | Dampak | Mitigasi |
|---|---|---|
| Rate limit & lockout **in-memory** | Reset saat restart; per-instance (tidak shared multi-replica) | Deploy single-instance (desain saat ini); naik ke Redis bila skala berubah |
| Admin **tunggal** (env) | Tidak ada multi-user/role | Cukup untuk personal trading; tambah tabel User bila perlu |
| Tanpa 2FA | Password satu faktor | Password panjang + lockout; batasi akses via VPN/tunnel |
| CSP `unsafe-inline`/`unsafe-eval` | Diperlukan Next.js hydration/Tailwind | Script eksternal tetap diblokir `default-src 'self'`; nonce-based CSP = pekerjaan lanjutan |
| Session 7 hari | Window panjang bila cookie dicuri | HttpOnly+SameSite+Secure; rotasi secret bila dicurigai |
| Email demo = simulasi | Tidak ada notifikasi riil keluar sandbox | LIVE engine punya SMTP sendiri (lihat python-engine/README) |
| `sqlite3` backup butuh binary | Container minimal tanpa sqlite3 | Image Docker sudah menyertakan `sqlite` |

## 4. Checklist Keamanan Produksi

- [ ] `SESSION_SECRET` acak ≥32 char (bukan default)
- [ ] `ADMIN_PASSWORD_HASH` scrypt terpasang; `ADMIN_PASSWORD` dihapus
- [ ] Login default `finex-admin-2025` tidak lagi berlaku
- [ ] HTTPS aktif (certbot/nginx) — cookie jadi `Secure`
- [ ] `ENGINE_API_KEY` 32-hex & **identik** di kedua sisi
- [ ] Engine tidak port-forward publik (tunnel/localhost)
- [ ] `.env` tidak ter-commit (`git ls-files | grep .env` kosong)
- [ ] PAT GitHub yang pernah terekspos sudah di-revoke
- [ ] Backup DB terjadwal + restore pernah diuji
- [ ] Uptime monitoring `/api/health` aktif
- [ ] Panel Logs kategori AUTH dipantau (percobaan gagal anomali)

## 5. Prosedur Insiden

| Skenario | Respons |
|---|---|
| Dicurigai session bocor | Ganti `SESSION_SECRET` → restart (semua session invalid) → cek audit AUTH |
| Password diketahui orang | `bun run hash-password <baru>` → update `.env` → restart → cek log login |
| Brute-force berlanjut | Lockout otomatis aktif; bila perlu blokir IP di nginx/ufw; pertimbangkan basic-auth tambahan |
| API key engine bocor | Generate baru → update `config.yaml` engine + `.env` dashboard → restart keduanya |
| PAT/repo terkompromi | Revoke token → audit commit (`git log -p`) → force-clean secret → rotate semua |
| DB rusak | Stop app → `gunzip backups/custom-<t>.db.gz` → ganti `db/custom.db` → start → verifikasi `/api/health` |

## 6. Verifikasi Berkala

```bash
# Header keamanan terkirim
curl -sI https://domain/api/health | grep -Ei "x-frame|content-security|referrer"

# Gate tertutup
curl -s -o /dev/null -w "%{http_code}\n" https://domain/api/settings   # 401

# Tidak ada secret di tree git
git grep -IE "(ghp_|sk-|scrypt:16384)" -- . ':!PRODUCTION.md' ':!CHANGELOG.md' | head
```
