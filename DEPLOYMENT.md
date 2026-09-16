# Panduan Deployment — FINEX AI Trading System

Tiga opsi deploy dashboard + setup engine LIVE. Untuk runbook operasional mendalam (backup, monitoring, troubleshooting) lihat [PRODUCTION.md](./PRODUCTION.md).

---

## 1. Prasyarat & Environment

| Komponen | Kebutuhan |
|---|---|
| Dashboard | Node 22+ / Bun 1.x (VPS) atau Docker |
| Database | SQLite (file tunggal, WAL) — tanpa server DB |
| Engine LIVE | PC Windows + Python 3.11+ + Terminal MetaTrader 5 + akun FINEX |
| Optional | API key Finnhub/Marketaux (berita real), SMTP (email) |

### Variabel environment (`.env`)

| Var | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | `file:<path absolut>/db/custom.db` |
| `SESSION_SECRET` | ✅ | `openssl rand -base64 48` — rotasi = semua session logout |
| `ADMIN_USERNAME` | — | default `admin` |
| `ADMIN_PASSWORD_HASH` | ✅ prod | `bun run hash-password <pw>` → format `scrypt:…` |
| `ADMIN_PASSWORD` | dev saja | plaintext (diabaikan bila hash ada) |
| `ENGINE_API_KEY` | LIVE | `openssl rand -hex 32` — **identik** dengan `api_key` engine |
| `FINNHUB_API_KEY` / `MARKETAUX_API_KEY` | — | berita real; kosong = simulasi |

> ⚠️ Tanpa hash & password env, sistem memakai default `admin / finex-admin-2025` (hint amber tampil di layar login). **Wajib diganti sebelum produksi.**

---

## 2. Opsi A — VPS (Ubuntu 22.04+)

```bash
# 1. Install bun
curl -fsSL https://bun.sh/install | bash

# 2. Clone & masuk
git clone https://github.com/teekar2312/frxai.git /opt/frxai && cd /opt/frxai

# 3. Dependency + env
bun install
cp .env.example .env && nano .env      # isi SESSION_SECRET + ADMIN_PASSWORD_HASH
# (DATABASE_URL default relatif file:../db/custom.db — tidak perlu diubah untuk VPS non-Docker)

# 4. Database
bunx prisma db push

# 5. Build produksi (output standalone)
bun run build

# 6. Jalankan dengan pm2
sudo npm i -g pm2
pm2 start "bun run start" --name finexai
pm2 save && pm2 startup
```

**Nginx reverse proxy + HTTPS:**
```nginx
server {
    server_name dashboard.contohanda.com;
    client_max_body_size 10M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo certbot --nginx -d dashboard.contohanda.com
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

## 3. Opsi B — Docker Compose

```bash
git clone https://github.com/teekar2312/frxai.git && cd frxai
cp .env.example .env && nano .env
# DATABASE_URL=file:/app/db/custom.db  (path di dalam container)
docker compose up -d --build
docker compose logs -f          # tunggu "Ready"
```
- Data persist di volume `./db` (SQLite) & `./backups`.
- Healthcheck otomatis ke `/api/health` (interval 30s).
- Update: `git pull && docker compose up -d --build`.

## 4. Opsi C — Windows Lokal (dashboard + engine 1 PC)

```powershell
# Dashboard
powershell -c "irm bun.sh/install.ps1 | iex"
git clone https://github.com/teekar2312/frxai.git C:\frxai && cd C:\frxai
bun install
copy .env.example .env          # DATABASE_URL default sudah relatif (tanpa edit); isi SESSION_SECRET!
bunx prisma db push
bun run build && bun run start
```

> Tanpa bun? Semua script juga berjalan dengan Node.js murni:
> `npm install` → `npm run db:push` → `npm run build` → `npm run start`
> (script `dev`/`build`/`start` adalah wrapper Node lintas platform — tidak butuh `tee`/`cp` Unix).
Engine: ikuti [python-engine/README.md](./python-engine/README.md) — `config.yaml` dengan `api_key` = `ENGINE_API_KEY` dan `allowed_origins: [http://localhost:3000]`.

---

## 5. Engine LIVE & Keamanan Jaringan

1. Di dashboard: tab **Engine Setup** → download ZIP engine → ekstrak di PC Windows.
2. `pip install -r requirements.txt`
3. Salin `config.example.yaml` → `config.yaml`: akun FINEX, MT5 path, `api_key` (identik `ENGINE_API_KEY` dashboard).
4. `python main.py` → FastAPI `:8000`.
5. Dashboard Settings → mode **LIVE** + `engineUrl`.

**Eksposur jaringan (urut aman → berisiko):**

| Metode | Kelayakan |
|---|---|
| `127.0.0.1` bind (dashboard & engine 1 mesin / tunnel ke VPS) | ✅ Terbaik |
| Cloudflare Tunnel / Tailscale dari PC → VPS | ✅ Disarankan bila terpisah mesin |
| LAN + `api_key` kuat | ⚠️ Boleh, pantau |
| Port-forward publik langsung | ❌ **Dilarang** — walau ada api_key |

## 6. Pasca-Deploy: Checklist Verifikasi

```bash
curl -s https://domain-anda/api/health      # {"status":"ok","db":"ok",...}
```
1. Buka `/` → login dengan kredensial baru → dashboard tampil (bukan layar login ulang).
2. Ganti password default (bila terlanjur) → cek tombol **Keluar** bekerja.
3. Tab Logs → kategori `AUTH` mencatat login sukses.
4. Mode DEMO: buka posisi kecil → close → muncul di history.
5. (LIVE) Badge header "LIVE ENGINE" hijau connected.

## 7. Update & Rollback

```bash
# Update
cd /opt/frxai && git pull && bun install
bunx prisma db push        # migrasi aditif
bun run build
pm2 restart finexai        # atau: docker compose up -d --build
```
**Rollback**: `git checkout <tag-lama> && bun install && bun run build && pm2 restart finexai` — skema DB hanya bertambah (aditif), sehingga versi lama tetap kompatibel.

## 8. Operasional

- **Backup DB**: `bun run db:backup` (gzip + retensi 14) — jadwalkan via cron (contoh di [PRODUCTION.md](./PRODUCTION.md) §8).
- **Monitoring**: `GET /api/health` publik → uptime-kuma / UptimeRobot / docker healthcheck.
- **Log**: `dev.log`/`server.log` + pm2 logs + panel Logs (audit AUTH).
- **Troubleshooting**: tabel gejala→solusi di [PRODUCTION.md](./PRODUCTION.md) §12.
