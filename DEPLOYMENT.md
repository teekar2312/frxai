# Deployment Guide

> Panduan lengkap deployment FINEX AI Trader menggunakan Visual Studio Code IDE di Windows 11

---

## Daftar Isi

- [Overview](#overview)
- [Prasyarat Sistem](#prasyarat-sistem)
- [Step 1: Install Software](#step-1-install-software)
- [Step 2: Clone Repository](#step-2-clone-repository)
- [Step 3: Buka di VS Code](#step-3-buka-di-vs-code)
- [Step 4: Install Dependencies](#step-4-install-dependencies)
- [Step 5: Konfigurasi Environment](#step-5-konfigurasi-environment)
- [Step 6: Setup Database](#step-6-setup-database)
- [Step 7: Jalankan Development](#step-7-jalankan-development)
- [Step 8: Testing](#step-8-testing)
- [Step 9: Production Build](#step-9-production-build)
- [Step 10: Run Production](#step-10-run-production)
- [Step 11: MT5 Setup](#step-11-mt5-setup)
- [Step 12: Go-Live Checklist](#step-12-go-live-checklist)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)
- [Update & Upgrade](#update--upgrade)

---

## Overview

Guide ini mencakup deployment lengkap FINEX AI Trader dari awal hingga go-live, menggunakan:

- **Windows 11** sebagai operating system
- **Visual Studio Code** sebagai IDE
- **Bun** sebagai JavaScript runtime
- **Git** untuk version control
- **MetaTrader 5** untuk koneksi broker

### Deployment Options

| Mode | Penggunaan | Perintah | Port |
|------|-----------|---------|------|
| Development | Development & testing | `bun run dev` | 3000 |
| Production | Live trading | `bun run build && bun run start` | 3000 |

---

## Prasyarat Sistem

### Minimum Hardware

| Komponen | Minimum | Rekomendasi |
|----------|---------|-------------|
| CPU | 4 core | 8+ core |
| RAM | 8 GB | 16 GB |
| Storage | 5 GB free | 10 GB free (SSD) |
| Network | 10 Mbps | 50+ Mbps, stabil |

### Software Requirements

| Software | Versi | Cara Cek |
|----------|-------|----------|
| Windows 11 | 22H2+ | Settings → System → About |
| Visual Studio Code | 1.85+ | Help → About |
| Bun | 1.3.x | `bun --version` |
| Git | 2.40+ | `git --version` |
| Python | 3.10+ | `python --version` |
| MetaTrader 5 | Build 4000+ | Help → About di MT5 |

---

## Step 1: Install Software

### 1.1 Install Bun

Buka **PowerShell** (Run as Administrator):

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verifikasi:

```powershell
bun --version
# Output: 1.3.x
```

### 1.2 Install Git

1. Download dari [git-scm.com](https://git-scm.com/download/win)
2. Jalankan installer
3. Pilih opsi:
   - **Git from the command line and also from 3rd-party software**
   - **Use the OpenSSL library**
   - **Checkout Windows-style, commit Unix-style line endings**
4. Set global config:

```powershell
git config --global user.name "Nama Anda"
git config --global user.email "email@anda.com"
```

### 1.3 Install Python

1. Download dari [python.org](https://www.python.org/downloads/)
2. Jalankan installer, **centang** "Add Python to PATH"
3. Verifikasi:

```powershell
python --version
# Output: 3.10.x atau 3.11.x atau 3.12.x
```

### 1.4 Install Visual Studio Code

1. Download dari [code.visualstudio.com](https://code.visualstudio.com/)
2. Jalankan installer
3. Pilih opsi:
   - **Add "Open with Code" action to Windows Explorer file context menu**
   - **Add "Open with Code" action to Windows Explorer directory context menu**

### 1.5 Install VS Code Extensions

Buka VS Code → Tekan `Ctrl+Shift+X` → Cari dan install:

| Extension | ID | Pentingnya |
|-----------|-----|-----------|
| Tailwind CSS IntelliSense | `bradlc.vscode-tailwindcss` | Wajib |
| Prisma | `prisma.prisma-vscode` | Wajib |
| ESLint | `dbaeumer.vscode-eslint` | Wajib |
| Error Lens | `usernamehw.errorlens` | Direkomendasikan |
| GitLens | `eamodio.gitlens` | Direkomendasikan |
| Prettier | `esbenp.prettier-vscode` | Direkomendasikan |
| Thunder Client | `rangav.vscode-thunder-client` | Opsional (API testing) |

### 1.6 Install MetaTrader 5

1. Download dari **FINEX Indonesia** broker portal
2. Jalankan installer
3. Login dengan kredensial FINEX
4. Pastikan **Auto Trading** button di toolbar MT5 aktif

---

## Step 2: Clone Repository

### Opsi A: Via VS Code Terminal

1. Buka VS Code
2. Tekan `Ctrl+`` ` (backtick) untuk membuka terminal
3. Navigasi ke folder yang diinginkan:

```powershell
# Contoh: clone ke Documents\projects
cd $env:USERPROFILE\Documents
mkdir projects
cd projects
```

4. Clone repository:

```powershell
git clone https://github.com/teekar2312/frxai.git
cd frxai
```

### Opsi B: Via Git GUI

1. Buka Windows Explorer
2. Klik kanan pada folder target → **Open in Terminal**
3. Jalankan `git clone https://github.com/teekar2312/frxai.git`
4. Buka folder `frxai` → Klik kanan → **Open with Code**

---

## Step 3: Buka di VS Code

```powershell
cd frxai
code .
```

Atau:

1. Buka Windows Explorer
2. Navigasi ke folder `frxai`
3. Klik kanan → **Open with Code**

### Verifikasi Structure

Di VS Code Explorer (sidebar kiri), pastikan:

```
frxai/
├── prisma/schema.prisma     ✓
├── src/lib/                 ✓ (10 files)
├── src/app/                 ✓ (page.tsx, api/)
├── src/components/          ✓ (trading/, ui/)
├── package.json             ✓
├── next.config.ts           ✓
└── .env.example             ✓
```

---

## Step 4: Install Dependencies

Di VS Code Terminal:

```powershell
bun install
```

Verifikasi (harus selesai tanpa error):

```

bun install v1.x.x

 + @prisma/client@6.x.x
 + next@16.x.x
 + react@19.x.x
 + ...

 Done in Xs
```

---

## Step 5: Konfigurasi Environment

### 5.1 Copy Template

```powershell
copy .env.example .env
```

### 5.2 Edit File .env

Di VS Code:

1. Klik file `.env` di Explorer
2. Isi setiap variable:

```env
# ============================================
# DATABASE
# ============================================
DATABASE_URL="file:./db/custom.db"

# ============================================
# FINEX MT5 BROKER CONNECTION
# ============================================
MT5_LOGIN="99999"                    # Ganti dengan nomor akun MT5 Anda
MT5_PASSWORD="your_secure_password"  # Ganti dengan password MT5
MT5_SERVER="FINEX-Server"            # Nama server broker

# ============================================
# NEWS API PROVIDERS
# ============================================
FINNHUB_API_KEY="your_finnhub_key"    # Dapatkan di finnhub.io
MARKETAUX_API_KEY="your_marketaux_key" # Dapatkan di marketaux.com

# ============================================
# SYSTEM
# ============================================
BASE_BALANCE="10000"                   # Saldo awal (USD)
NODE_ENV="development"
```

### 5.3 Verify .env Loaded

Pastikan file `.env` tidak muncul di VS Code Source Control ( Changes ). Jika muncul, berarti `.gitignore` belum benar — **jangan commit**.

---

## Step 6: Setup Database

### 6.1 Generate Prisma Client

```powershell
bun run db:generate
```

Expected output:

```

Prisma Client generated

✔ Generated Prisma Client (6.x.x)
```

### 6.2 Push Schema to Database

```powershell
bun run db:push
```

Expected output:

```

Your database is now in sync with your Prisma schema.

✔ Generated Prisma Client
```

### 6.3 Verify Database

Buka VS Code Explorer → expand folder `db/` → pastikan file `custom.db` ada.

---

## Step 7: Jalankan Development

### 7.1 Start Dev Server

```powershell
bun run dev
```

Expected output:

```

  ▲ Next.js 16.x.x
  - Local:   http://localhost:3000

 ✓ Ready in Xs
```

### 7.2 Buka di Browser

1. Buka browser (Chrome/Edge/Firefox)
2. Navigasi ke `http://localhost:3000`
3. Verifikasi:
   - Dashboard loading ✓
   - Tab navigation berfungsi ✓
   - MT5 status badge muncul ✓

### 7.3 Hot Reload

Saat Anda mengedit file:

- `.tsx` / `.ts` files → Browser otomatis refresh
- `prisma/schema.prisma` → Perlu `bun run db:push` + restart server
- `.env` → Restart server (`Ctrl+C` lalu `bun run dev`)

---

## Step 8: Testing

### 8.1 Test Dasar (di Browser)

| Fitur | Cara Test | Expected |
|-------|-----------|----------|
| Dashboard | Buka `/` | Loading, charts, watchlist |
| Live Trading | Tab "Live Trading" | Trade positions panel |
| AI & Sentiment | Tab "AI & Sentiment" | AI panel, sentiment gauge |
| Strategies | Tab "Strategies" | 7 strategy cards |
| Risk & Money | Tab "Risk & Money" | Risk dashboard |
| News | Tab "News" | News feed panel |
| Alerts | Tab "Alerts" | Price alerts panel |
| Sessions | Tab "Sessions" | IDX/Forex sessions |
| System Logs | Tab "System Logs" | Log viewer |
| Audit | Tab "Audit" | Compliance status |

### 8.2 Test API (via Thunder Client atau Browser)

Buka Thunder Client (VS Code extension) atau browser:

```
GET http://localhost:3000/api/account
GET http://localhost:3000/api/stocks
GET http://localhost:3000/api/mt5/status
GET http://localhost:3000/api/sessions
GET http://localhost:3000/api/indicators/compute?symbol=BBCA&indicators=RSI,MACD
```

### 8.3 Linting

```powershell
bun run lint
```

Harus: **0 errors, 0 warnings**

---

## Step 9: Production Build

### 9.1 Stop Dev Server

Tekan `Ctrl+C` di terminal VS Code.

### 9.2 Build

```powershell
bun run build
```

Expected output:

```

 ✓ Compiled successfully
 ✓ Linting and checking validity of types
 ✓ Collecting page data
 ✓ Generating static pages
 ✓ Finalizing page optimization

Route (app)            Size    First Load JS
┌ ○ /                  XX kB   XX kB
└ ○ /api/*             XX kB   XX kB

 ✓ Build completed
```

### 9.3 Verify Build Output

```powershell
# Cek bahwa standalone server di-generate
ls .next/standalone/server.js
```

---

## Step 10: Run Production

### 10.1 Start Production Server

```powershell
bun run start
```

Output akan ditulis ke `server.log`.

### 10.2 Verify

Buka `http://localhost:3000` — harus sama dengan development mode.

### 10.3 Stop Production Server

Tekan `Ctrl+C` di terminal.

### 10.4 Production Notes

- `NODE_ENV=production` — Prisma tidak log queries
- No hot-reload — perlu rebuild untuk perubahan code
- Port tetap 3000

---

## Step 11: MT5 Setup

### 11.1 Verify MT5 Connection

1. Pastikan **MetaTrader 5** sudah terbuka dan login
2. Pastikan **Auto Trading** button berwarna hijau
3. Di browser, buka dashboard FINEX AI Trader
4. Klik **"Connect MT5"** atau gunakan API:

```
POST http://localhost:3000/api/mt5/connect
Content-Type: application/json

{
  "login": "99999",
  "password": "your_password",
  "server": "FINEX-Server"
}
```

### 11.2 Verify Connection Status

```
GET http://localhost:3000/api/mt5/status
```

Expected: `{ "success": true, "data": { "status": "CONNECTED", ... } }`

### 11.3 Enable Auto Trading

Toggle button **"Auto Trading"** di header dashboard, atau:

```
PUT http://localhost:3000/api/system/trading-enabled
Content-Type: application/json

{
  "enabled": true
}
```

---

## Step 12: Go-Live Checklist

### Pre-Go-Live

- [ ] `bun run lint` — 0 errors, 0 warnings
- [ ] `bun run build` — Build berhasil tanpa error
- [ ] `.env` terisi lengkap dengan kredensial production
- [ ] MT5 terkoneksi dan heartbeat stabil
- [ ] Semua 7 strategi menghasilkan sinyal
- [ ] Risk limits sesuai preferensi (cek `/api/risk`)
- [ ] Emergency close berfungsi (test di akun demo)
- [ ] Audit trail tercatat (cek `/api/audit`)
- [ ] Windows Firewall block port 3000 dari network

### Akun Demo → Real

- [ ] Test minimal 1 minggu di akun demo
- [ ] Win rate stabil > 55%
- [ ] Max drawdown < 5%
- [ ] Tidak ada unexpected errors di log
- [ ] Ganti `.env` ke kredensial akun real
- [ ] Set `NODE_ENV=production`

### Post-Go-Live

- [ ] Monitor pertama 1 jam tanpa auto-trading
- [ ] Aktifkan auto-trading dengan position size kecil
- [ ] Monitor setiap 30 menit pada hari pertama
- [ ] Review audit trail di akhir hari
- [ ] Backup database setiap hari

---

## Troubleshooting

### Bun: Command not found

```powershell
# Cek apakah Bun ada di PATH
$env:PATH -split ";" | Select-String "bun"

# Jika tidak ada, tambahkan manual
$env:PATH += ";$env:USERPROFILE\.bun\bin"

# Atau install ulang
powershell -c "irm bun.sh/install.ps1 | iex"
```

### Port 3000 sudah dipakai

```powershell
# Cek proses yang pakai port 3000
netstat -ano | findstr :3000

# Kill proses (ganti PID)
taskkill /PID <PID> /F
```

### Database Error

```powershell
# Reset database
bun run db:push -- --force-reset

# Jika masih error, hapus manual
Remove-Item db\custom.db -Force
bun run db:generate
bun run db:push
```

### Build Gagal

```powershell
# Clear cache
Remove-Item -Recurse -Force .next

# Reinstall dependencies
Remove-Item -Recurse -Force node_modules
bun install

# Rebuild
bun run build
```

### MT5 Connection Failed

1. Pastikan MT5 terminal sudah terbuka
2. Pastikan kredensial di `.env` benar
3. Pastikan MT5 Python bridge berjalan (jika menggunakan bridge)
4. Cek log di browser console atau `/api/logs?level=ERROR&category=MT5_CONNECTION`

### Prisma Client Error

```powershell
# Regenerate Prisma Client
bun run db:generate

# Jika error persist, clear Prisma cache
Remove-Item -Recurse -Force node_modules\.prisma
Remove-Item -Recurse -Force node_modules\@prisma
bun install
bun run db:generate
```

### Lint Errors

```powershell
# Auto-fix
bun run lint --fix

# Jika masih ada error, baca pesan error dan fix manual
```

---

## Maintenance

### Backup Database

```powershell
# Buat folder backup
mkdir db\backup -ErrorAction SilentlyContinue

# Backup dengan timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
copy db\custom.db "db\backup\custom_$timestamp.db"
```

### View Logs

```powershell
# Development log
type dev.log | more

# Production log
type server.log | more

# Atau gunakan PowerShell
Get-Content dev.log -Tail 50
Get-Content server.log -Tail 50
```

### Database Maintenance

```powershell
# Check database integrity
# (SQLite vacuum — mengoptimalkan file)
# Jalankan via Prisma Studio atau sqlite3 CLI
```

### Update Risk Configuration

Gunakan dashboard (tab Risk & Money) atau API:

```powershell
# Cek current config
GET http://localhost:3000/api/risk
```

---

## Update & Upgrade

### Update Dependencies

```powershell
# Cek outdated packages
bun outdated

# Update semua dependencies
bun update

# Verifikasi build masih berhasil
bun run build

# Lint check
bun run lint
```

### Pull Latest Code

```powershell
# Stop dev server (Ctrl+C)
git checkout main
git pull origin main

# Reinstall dependencies (jika package.json berubah)
bun install

# Regenerate Prisma Client (jika schema berubah)
bun run db:generate
bun run db:push

# Restart dev server
bun run dev
```

### Rollback

```powershell
# Lihat commit history
git log --oneline -10

# Rollback ke commit tertentu
git checkout <commit-hash>

# Atau reset (HATI-HATI: menghapus changes yang belum commit)
git reset --hard <commit-hash>
```

---

## Windows-Specific Notes

### PowerShell vs Command Prompt

- **Gunakan PowerShell** untuk semua perintah di dokumentasi ini
- Beberapa perintah mungkin perlu disesuaikan untuk CMD
- VS Code Terminal default ke PowerShell

### File Path Separator

- Windows menggunakan `\` (backslash)
- Git Bash dan Node.js menggunakan `/` (forward slash)
- Di `.env`, gunakan `/` (forward slash) untuk path

### Long Path Names

Jika error "path too long":

```powershell
# Enable long paths di Windows
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### Antivirus / Windows Defender

- Windows Defender mungkin scan `node_modules` saat `bun install` — ini normal
- Jika terlalu lambat, tambahkan exclusion untuk folder project:

```powershell
# Hanya untuk development, jangan lupa hapus setelah selesai
Add-MpPreference -ExclusionPath "$env:USERPROFILE\projects\frxai"
```

### Auto-Start (Optional)

Untuk menjalankan server otomatis saat Windows startup:

1. Buka **Task Scheduler** (Win+R → `taskschd.msc`)
2. Create Basic Task
3. Trigger: "When the computer starts"
4. Action: "Start a program"
5. Program: `bun`
6. Arguments: `run start`
7. Start in: path ke folder `frxai`

> **Catatan**: Pastikan MT5 juga auto-start untuk koneksi broker.