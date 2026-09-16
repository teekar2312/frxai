# Panduan Deployment Produksi — FINEX AI Trading System

Dokumen ini adalah panduan lengkap menjalankan **FINEX AI Trading System** di lingkungan produksi:
deploy dashboard Next.js ke VPS/Docker/PC lokal, konfigurasi autentikasi, koneksi Python engine LIVE
(akun real FINEX Indonesia), backup database, monitoring, hingga checklist keamanan.

> ⚠️ **Peringatan risiko**: mode LIVE terhubung ke akun trading **real**. Backtest dulu di mode DEMO,
> gunakan risk per trade minimal (0.5%), aktifkan daily limit 2%, dan pantau engine di jam-jam pertama.
> Baca juga peringatan lengkap di `python-engine/README.md`.

**Repository**: https://github.com/teekar2312/frxai

---

## Daftar Isi

1. [Arsitektur & Prasyarat](#1-arsitektur--prasyarat)
2. [Variabel Lingkungan](#2-variabel-lingkungan)
3. [Setup Autentikasi](#3-setup-autentikasi)
4. [Deployment Opsi A — VPS (Ubuntu 22.04+)](#4-deployment-opsi-a--vps-ubuntu-2204)
5. [Deployment Opsi B — Docker Compose](#5-deployment-opsi-b--docker-compose)
6. [Deployment Opsi C — Windows Lokal](#6-deployment-opsi-c--windows-lokal-dashboard--engine-1-pc)
7. [Python Engine LIVE & Keamanan Jaringan](#7-python-engine-live--keamanan-jaringan)
8. [Backup & Restore](#8-backup--restore)
9. [Monitoring](#9-monitoring)
10. [Prosedur Update](#10-prosedur-update)
11. [Checklist Keamanan Produksi](#11-checklist-keamanan-produksi)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Arsitektur & Prasyarat

```
┌─────────┐    HTTPS (nginx)    ┌───────────────────────────┐   HTTP + header X-Engine-Key   ┌──────────────────────────────┐
│ Browser │ ──────────────────▶ │  Dashboard Next.js        │ ────────────────────────────▶ │  Python Engine (FastAPI)     │
│  (Anda) │ ◀────────────────── │  VPS / Docker · :3000     │ ◀──────────────────────────── │  PC Windows · :8000          │
└─────────┘    JSON (poll 2s)   │  • Login JWT (cookie)     │    /api/v1/poll, dll.          │  • MetaTrader 5 (akun real)  │
                                 │  • Auth + rate limit API  │                                │  • 30 indikator + AI + ML    │
                                 └───────────────────────────┘                                └──────────────────────────────┘
```

- **Dashboard** (repo ini) — Next.js 16 standalone. Satu-satunya route UI adalah `/`. Menyimpan state
  (settings, posisi, analisa, log, backtest) di **SQLite** via Prisma. Mode `DEMO` menjalankan simulator
  realistis di server; mode `LIVE` me-proxy data ke Python engine.
- **Python engine** (`python-engine/`) — dijalankan di PC Windows yang terpasang MetaTrader 5.
  Di-download user dari tab **Engine Setup** dashboard (ZIP via `GET /api/engine/download`), atau diambil
  langsung dari repo. Semua komunikasi dashboard → engine dijaga oleh API key (`ENGINE_API_KEY`).

### Prasyarat

| Komponen | Versi | Keterangan |
| --- | --- | --- |
| **Node.js** | 18+ (22+ disarankan) | **Wajib** — script `dev`/`build`/`start` adalah wrapper Node lintas platform (`node scripts/*.mjs`); juga runtime server standalone di Docker |
| **Bun** | 1.x | Opsional — install dependency cepat & menjalankan script (`bun run ...`; tetap butuh Node di PATH) |
| **Docker + Compose** | opsional | Hanya untuk Opsi B (Docker) |
| **Python** | 3.11+ (64-bit) | Hanya untuk Python engine LIVE, di PC Windows (dapat dijalankan hingga 3.14) |
| **Git** | 2.x | Clone repository |
| **sqlite3 CLI** | 3.x | Untuk script backup `scripts/backup-db.sh` |
| **MetaTrader 5** | build terbaru | Hanya di PC Windows yang menjalankan engine, akun real FINEX Indonesia |

---

## 2. Variabel Lingkungan

Salin template lalu isi:

```bash
cp .env.example .env
```

| Variabel | Wajib? | Default | Keterangan & Cara Generate |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | `file:./db/custom.db` (dev) | Path SQLite. **Gunakan path ABSOLUT di server produksi**, contoh `file:/opt/frxai/db/custom.db`. **Di Docker wajib** `file:/app/db/custom.db` (path volume di dalam container). |
| `SESSION_SECRET` | ✅ (produksi) | — | Secret penandatangan session JWT admin. Generate: `openssl rand -base64 48`. Wajib diganti — jangan pakai contoh. |
| `ADMIN_USERNAME` | — | `admin` | Username login dashboard. |
| `ADMIN_PASSWORD` | ⛔ dev only | — | Password **plaintext**, hanya untuk development. **JANGAN dipakai di produksi** — gunakan hash di bawah. |
| `ADMIN_PASSWORD_HASH` | ✅ (produksi) | — | Hash scrypt password admin. Generate: `bun run hash-password <passwordBaru>` (min. 8 karakter). Format: `scrypt:16384:8:1:<salt>:<hash>`. |
| `ENGINE_API_KEY` | bila pakai LIVE | — | API key antara dashboard ↔ Python engine. **Harus identik** dengan `server.api_key` di `python-engine/config.yaml`. Generate: `openssl rand -hex 32`. |
| `FINNHUB_API_KEY` | — | kosong | API key berita Finnhub. Kosong → dashboard memakai berita simulasi/kalender statis. |
| `MARKETAUX_API_KEY` | — | kosong | API key berita MarketAux. Kosong → berita simulasi. |

Urutan pembacaan password admin (yang pertama tersedia yang dipakai):

1. `ADMIN_PASSWORD_HASH` — **produksi** (scrypt hash)
2. `ADMIN_PASSWORD` — fallback plaintext, **development saja**
3. Password bawaan `finex-admin-2025` — **hanya untuk preview awal**, selalu disertai warning di log. **TIDAK BOLEH dipakai di produksi.**

> `.env` sudah masuk `.gitignore` — **jangan pernah di-commit**.

---

## 3. Setup Autentikasi

### Cara kerja (ringkasan desain)

- **Session JWT custom**: login berhasil → server menandatangani token **HS256** (library `jose`) dengan
  secret `SESSION_SECRET`, lalu menyimpannya pada cookie **`finex_session`** — atribut **HttpOnly** (tidak
  bisa dibaca JavaScript, aman dari XSS), **SameSite=Lax** (proteksi CSRF dasar). Masa berlaku **7 hari**.
- **Kredensial admin**: username dari env `ADMIN_USERNAME` (default `admin`); password diverifikasi dari
  env `ADMIN_PASSWORD_HASH` — format `scrypt:16384:8:1:<saltB64url>:<hashB64url>`, dihasilkan oleh
  `bun run hash-password <password>`. Fallback `ADMIN_PASSWORD` (plaintext, dev only) atau password
  bawaan `finex-admin-2025` (selalu diberi warning — **jangan pernah di produksi**).
- **Anti brute-force login**: 5 percobaan gagal per IP → IP terkunci **15 menit** (HTTP `429`).
- **Rate limit API (per IP)**: `240` request/menit untuk `GET`, `60` request/menit untuk
  `POST/PUT/DELETE`. Melebihi kuota → HTTP `429`.
- **Endpoint publik (tanpa login)**: `/api/auth/*` (login/logout/session) dan `/api/health`
  (mengembalikan `status`/`db`/`mode`/`uptime`/`version`). **Semua** endpoint `/api/*` lainnya wajib
  session valid → tanpa session balas `401` (JSON).
- **Halaman `/`**: menampilkan **layar login** bila belum terautentikasi, dan **dashboard penuh**
  bila sudah login.

### Langkah konfigurasi

```bash
# 1) Generate secret session (salin hasilnya)
openssl rand -base64 48

# 2) Generate hash password admin (min. 8 karakter)
bun run hash-password PasswordRahasiaAnda
# → scrypt:16384:8:1:XXXX...:YYYY...

# 3) Isi .env
```

```env
SESSION_SECRET=<hasil openssl rand -base64 48>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt:16384:8:1:XXXX...:YYYY...
ADMIN_PASSWORD=
```

```bash
# 4) Restart aplikasi agar .env dibaca ulang
pm2 restart finexai          # Opsi A (VPS)
docker compose restart       # Opsi B (Docker)
```

### Peringatan penting

- ⚠️ Password default `finex-admin-2025` **hanya untuk preview awal** setelah install — **WAJIB diganti**
  sebelum sistem diakses dari jaringan publik.
- ⚠️ Mengganti / merotasi `SESSION_SECRET` **mem-invalidasi semua session** — semua browser akan
  diminta login ulang. Lakukan bila secret dicurigai bocor.
- Hapus/kosongkan `ADMIN_PASSWORD` setelah `ADMIN_PASSWORD_HASH` terpasang agar jalur plaintext tertutup.

---

## 4. Deployment Opsi A — VPS (Ubuntu 22.04+)

```bash
# 1) Install Bun
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc

# 2) Clone repo
sudo mkdir -p /opt/frxai && sudo chown $USER /opt/frxai
git clone https://github.com/teekar2312/frxai.git /opt/frxai
cd /opt/frxai

# 3) Dependency
bun install

# 4) Environment
cp .env.example .env
nano .env   # isi DATABASE_URL (path absolut), SESSION_SECRET, ADMIN_PASSWORD_HASH

# 5) Siapkan database SQLite (membuat tabel via Prisma)
bunx prisma db push

# 6) Build produksi (output standalone)
bun run build

# 7) Jalankan dengan pm2 (agar auto-restart & jalan saat boot)
sudo npm install -g pm2
pm2 start "bun run start" --name finexai
pm2 save && pm2 startup     # ikuti instruksi yang muncul
```

> Catatan: script `start` menjalankan **server standalone** hasil build
> (`bun .next/standalone/server.js`) — bukan `next start`.

### Reverse proxy nginx

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/finexai
```

```nginx
server {
    listen 80;
    server_name dashboard.domainanda.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Dukungan websocket (dibutuhkan bila dipakai nanti)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Upload konten (logo, dsb.) dan ZIP engine tetap aman
        client_max_body_size 10M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/finexai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### HTTPS (certbot)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dashboard.domainanda.com
# Perpanjangan otomatis sudah aktif (timer systemd); tes: sudo certbot renew --dry-run
```

### Firewall (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Selesai — buka `https://dashboard.domainanda.com`, login, dan lanjutkan ke [bagian 7](#7-python-engine-live--keamanan-jaringan) bila menghubungkan engine LIVE.

---

## 5. Deployment Opsi B — Docker Compose

```bash
# 1) Clone & siapkan environment
git clone https://github.com/teekar2312/frxai.git && cd frxai
cp .env.example .env
nano .env
```

Minimal isi di `.env` untuk Docker:

```env
# WAJIB path di dalam container (volume ./db:/app/db)
DATABASE_URL=file:/app/db/custom.db

SESSION_SECRET=<hasil: openssl rand -base64 48>
ADMIN_PASSWORD_HASH=<hasil: bun run hash-password ...>
ADMIN_PASSWORD=

# Bila dashboard akan terhubung ke Python engine LIVE:
ENGINE_API_KEY=<hasil: openssl rand -hex 32>
```

```bash
# 2) Build & jalankan
docker compose up -d --build

# 3) Pantau log sampai muncul "Ready"
docker compose logs -f
```

Catatan:

- **Data persisten** tersimpan di folder `./db` (SQLite) dan `./backups` (backup) di host — aman
  saat container di-rebuild/replace.
- Image runner adalah `node:22-alpine` + `openssl` + `sqlite`, berisi server standalone, static
  assets, `public/`, dan `python-engine/` (untuk route download ZIP engine).
- Healthcheck otomatis memanggil `GET /api/health` setiap 30 detik — cek status dengan
  `docker compose ps`.
- Masuk ke container (misal untuk backup manual): `docker compose exec finexai sh`.

---

## 6. Deployment Opsi C — Windows Lokal (dashboard + engine 1 PC)

Cocok untuk mulai dengan cepat: dashboard dan Python engine berjalan di PC yang sama.

**Dashboard:**

```powershell
# 1) Install Bun untuk Windows: https://bun.sh  (atau: powershell -c "irm bun.sh/install.ps1 | iex")
# 2) Clone & masuk folder
git clone https://github.com/teekar2312/frxai.git
cd frxai

# 3) Environment
copy .env.example .env
# edit .env: DATABASE_URL=file:C:/frxai/db/custom.db (path absolut, forward-slash),
#            SESSION_SECRET + ADMIN_PASSWORD_HASH

# 4) Database + build + jalankan
bunx prisma db push
bun run build
bun run start
```

Dashboard berjalan di `http://localhost:3000`.

**Python engine (di PC yang sama):**

1. Siapkan `python-engine/config.yaml` (salin dari `config.example.yaml`), lalu set:

```yaml
server:
  api_key: "<SAMA PERSIS dengan ENGINE_API_KEY di .env dashboard>"
  allowed_origins: ["http://localhost:3000"]
```

2. Ikuti langkah lengkap instalasi engine di `python-engine/README.md`
   (venv, `pip install -r requirements.txt`, login MT5, `python main.py`).
3. Di dashboard: **Settings → Engine Connection → LIVE**, isi Engine URL
   `http://localhost:8000`, simpan — indikator koneksi harus hijau (connected).

> Karena dashboard dan engine satu mesin, engine cukup bind `127.0.0.1` (default) — tidak ada port
> yang terbuka ke jaringan luar.

---

## 7. Python Engine LIVE & Keamanan Jaringan

Dashboard (VPS/Docker) berkomunikasi ke engine lewat HTTP dengan header `X-Engine-Key`.
Kunci keselarasan konfigurasi:

| Sisi | File | Kunci |
| --- | --- | --- |
| Dashboard | `.env` | `ENGINE_API_KEY` |
| Engine | `python-engine/config.yaml` | `server.api_key` |

**Kedua nilai harus identik** — beda satu karakter saja semua permintaan ditolak (401/403).

### Rekomendasi keamanan jaringan

- ⛔ **JANGAN port-forward port 8000 langsung ke internet** (mis. via router). Engine menangani uang
  riil — jangan pernah expose mentah.
- ✅ **Cloudflare Tunnel** (gratis, engine tetap di belakang NAT):
  `cloudflared tunnel --url http://localhost:8000` → dapatkan URL HTTPS publik, isi sebagai
  `engineUrl` di dashboard dan masukkan ke `allowed_origins` engine.
- ✅ **Tailscale** (jaringan privat): pasang di VPS dan PC Windows, isi `engineUrl` dengan alamat
  `tailscale IP`/MagicDNS PC Windows — tidak ada endpoint publik sama sekali.
- ✅ **Satu mesin** (Opsi C): bind engine ke `127.0.0.1` (default `api.host`) — paling aman.
- ✅ Batasi `allowed_origins` di config engine hanya ke origin dashboard Anda.
- ✅ Engine menyediakan `GET /api/v1/health` **publik** (tanpa API key) khusus untuk monitoring
  up/down — endpoint lain wajib header `X-Engine-Key`.

Contoh `config.yaml` (engine di PC Windows, dashboard di VPS dengan domain):

```yaml
api:
  host: 127.0.0.1        # tetap lokal; akses dari luar via tunnel
  port: 8000

server:
  api_key: "3f9c1e...<64 hex chars>"
  allowed_origins: ["https://dashboard.domainanda.com"]
```

---

## 8. Backup & Restore

### Backup (online — aman saat aplikasi berjalan)

```bash
# Default: ./db/custom.db → ./backups/custom-YYYYmmdd-HHMMSS.db.gz (simpan 14 terbaru)
bun run db:backup

# Kustomisasi lokasi & jumlah:
DB_PATH=/opt/frxai/db/custom.db BACKUP_DIR=/var/backups/frxai KEEP=30 bash scripts/backup-db.sh
```

Script memakai SQLite Online Backup API (`sqlite3 .backup`) — konsisten meski database sedang
ditulis aplikasi, lalu mengompres dengan `gzip -9` dan memangkas backup lama otomatis.

### Jadwalkan dengan cron (VPS)

```bash
crontab -e
```

```cron
0 2 * * * cd /opt/frxai && bash scripts/backup-db.sh >> backups/cron.log 2>&1
```

### Restore

```bash
# 1) Hentikan aplikasi (agar tidak menulis saat restore)
pm2 stop finexai            # atau: docker compose down

# 2) Ekstrak backup pilihan
gunzip -k backups/custom-20250901-020000.db.gz
# → menghasilkan backups/custom-20250901-020000.db

# 3) Ganti database aktif (backup dulu file lama bila perlu)
cp backups/custom-20250901-020000.db db/custom.db

# 4) Jalankan lagi
pm2 start finexai           # atau: docker compose up -d
```

---

## 9. Monitoring

- **`GET /api/health`** (publik, tanpa login) — heartbeat dashboard:

```json
{
  "status": "ok",
  "db": "ok",
  "mode": "demo",
  "uptime": 3600,
  "version": "0.2.1"
}
```

  Gunakan untuk probe liveness (docker healthcheck sudah memakainya) dan monitor eksternal.
- **Uptime monitoring eksternal** — pasang [Uptime Kuma](https://github.com/louislam/uptime-kuma)
  (self-host, gratis) atau Uptimerobot, arahkan ke URL `https://domainanda/api/health`, interval 60s,
  notifikasi ke Telegram/email bila down.
- **Engine** — pantau `GET /api/v1/health` engine (publik) untuk memastikan PC Windows/engine hidup.
- **Log**:
  - `dev.log` — output `bun run dev` (development).
  - `server.log` — output `bun run start` (produksi; dibuat oleh script start).
  - `pm2 logs finexai` — log + error pm2 (Opsi A).
  - `docker compose logs -f` — log container (Opsi B).
- **Dashboard** — tab **Logs** menampilkan LogEntry level/kategori langsung dari database.

---

## 10. Prosedur Update

```bash
cd /opt/frxai

git pull                      # ambil kode terbaru
bun install                   # sinkronkan dependency bila berubah
bunx prisma db push           # terapkan perubahan skema database (aman, non-destruktif)
bun run build                 # build ulang standalone

pm2 restart finexai           # Opsi A
# atau (Opsi B):
docker compose up -d --build
```

> `prisma db push` tidak menghapus data existing; kolom baru diisi default. Tetap jalankan
> backup dulu bila update besar: `bun run db:backup`.

---

## 11. Checklist Keamanan Produksi

- [ ] **REVOKE PAT GitHub yang pernah terekspos** (token `ghp_U4XG…` yang dipakai saat push awal) di
      GitHub → Settings → Developer settings → Personal access tokens, lalu generate token baru.
- [ ] Password default `finex-admin-2025` **sudah diganti** — `ADMIN_PASSWORD_HASH` terpasang,
      `ADMIN_PASSWORD` dikosongkan.
- [ ] `SESSION_SECRET` acak ≥ 48 karakter dan **tidak pernah di-commit**.
- [ ] `ENGINE_API_KEY` 32 karakter hex (`openssl rand -hex 32`) dan **identik** dengan `server.api_key`
      di `python-engine/config.yaml`.
- [ ] HTTPS aktif (certbot/Let's Encrypt) — tidak ada akses HTTP polos ke dashboard.
- [ ] `.env` tidak di-commit ke git (sudah berada dalam `.gitignore`).
- [ ] Backup database terjadwal (cron harian) + pernah diuji restore.
- [ ] Firewall aktif: `ufw` hanya membuka 22/80/443 (VPS); pertimbangkan `fail2ban` untuk SSH.
- [ ] CORS engine dibatasi — `allowed_origins` hanya berisi origin dashboard Anda.
- [ ] Engine **tidak** di-port-forward langsung; akses via Cloudflare Tunnel / Tailscale / localhost.
- [ ] Monitoring `/api/health` aktif (Uptime Kuma / Uptimerobot).

---

## 12. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
| --- | --- | --- |
| Login selalu gagal setelah deploy | `SESSION_SECRET` berubah/tidak diset; atau akses via `http://` tanpa HTTPS sementara cookie ditulis untuk konteks secure | Pastikan `SESSION_SECRET` konsisten & terisi; akses dashboard via domain HTTPS (atau `localhost`); cek `ADMIN_PASSWORD_HASH` satu baris utuh tanpa spasi/quote |
| Semua API balas `401` | Session kedaluwarsa (7 hari) atau cookie `finex_session` hilang | Login ulang; pastikan browser tidak memblokir cookie; jangan rotasi `SESSION_SECRET` tanpa perlu |
| `429 Too Many Requests` | Rate limit per IP tersentuh (240 req/menit GET, 60 req/menit tulis) atau 5× salah password → kunci 15 menit | Tunggu sebentar; pastikan tidak ada tab/tooling yang spam polling; bila terkunci login, tunggu 15 menit |
| Database `readonly` / gagal menulis (SQLite error 1032) | Izin folder `db/` bukan milik user aplikasi; atau path `DATABASE_URL` salah | `chown -R $USER:$USER db/`; pastikan `DATABASE_URL` absolut & benar (Docker: `file:/app/db/custom.db`); restart aplikasi |
| Engine unreachable (`connected=false` padahal engine jalan) | `api_key` beda; `allowed_origins` tidak memuat origin dashboard; URL/port salah; engine di belakang NAT tanpa tunnel | Samakan `ENGINE_API_KEY` ↔ `server.api_key`; tambahkan origin dashboard ke `allowed_origins`; cek `engineUrl` + port; gunakan Cloudflare Tunnel/Tailscale; tes `GET /api/v1/health` engine |
| ZIP engine gagal di-download | Folder `python-engine/` tidak ikut ter-deploy (mis. image Docker lama) | Rebuild dengan Dockerfile terbaru (stage runner menyalin `python-engine/`); pastikan folder ada di server |
| `bun run build` gagal di server baru | Dependency/Prisma belum tersinkron | `bun install && bunx prisma generate`, lalu build ulang; cek log error pertama yang muncul |
| Port 3000/8000 sudah dipakai | Aplikasi lain memakai port | Ubah port (`-p` / `PORT` env untuk dashboard; `api.port` untuk engine) sesuaikan pula nginx & engineUrl |

---

*Dokumen ini bagian dari FINEX AI Trading System — lihat juga `python-engine/README.md` untuk panduan
lengkap engine, dan `worklog.md` untuk riwayat pengembangan.*
