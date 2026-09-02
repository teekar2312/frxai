# Security

> Panduan keamanan untuk FINEX AI Trader

---

## Daftar Isi

- [Security Model](#security-model)
- [Environment Variables](#environment-variables)
- [Authentication & Access Control](#authentication--access-control)
- [API Security](#api-security)
- [Database Security](#database-security)
- [Broker Connection Security](#broker-connection-security)
- [External API Security](#external-api-security)
- [Input Validation](#input-validation)
- [Logging & Monitoring](#logging--monitoring)
- [Deployment Security](#deployment-security)
- [Security Checklist](#security-checklist)
- [Vulnerability Reporting](#vulnerability-reporting)

---

## Security Model

FINEX AI Trader dirancang sebagai **single-user trading system** yang berjalan di lingkungan lokal (Windows 11). Model keamanan mengikuti prinsip:

| Prinsip | Implementasi |
|---------|---------------|
| **Least Privilege** | MT5 account menggunakan permission minimal yang diperlukan |
| **Defense in Depth** | Multiple risk layers (pre-trade, margin, daily limits) |
| **Fail Secure** | Sistem default ke mode aman (trading OFF) jika error |
| **No External Exposure** | API tidak diekspos ke internet tanpa reverse proxy + auth |

---

## Environment Variables

### File .env

File `.env` berisi kredensial sensitif dan **TIDAK BOLEH** di-commit ke repository.

```
# .gitignore sudah mengandung:
.env*
```

### Variabel Sensitif

| Variable | Sensitivitas | Risiko jika bocor |
|----------|--------------|-------------------|
| `MT5_LOGIN` | **KRITIS** | Akses ke akun trading real
| `MT5_PASSWORD` | **KRITIS** | Akses ke akun trading real
| `FINNHUB_API_KEY` | Sedang | API rate limit exhaustion
| `MARKETAUX_API_KEY` | Sedang | API rate limit exhaustion |
| `DATABASE_URL` | Rendah | Akses database lokal |
| `BASE_BALANCE` | Rendah | Informasi keuangan |

### Best Practices

1. **Selalu gunakan `.env.example`** sebagai template, jangan edit langsung
2. **Jangan copy-paste** kredensial ke chat, email, atau screenshot
3. **Rotate password** MT5 secara berkala (minimal 90 hari)
4. **Gunakan akun demo** untuk development dan testing
5. **Gunakan akun real** hanya setelah semua testing selesai

---

## Authentication & Access Control

### Current State (Single-User)

Sistem ini saat ini **tidak memiliki authentication layer** karena dirancang untuk penggunaan personal di localhost.

### Rekomendasi untuk Production

Jika akan di-deploy ke server yang dapat diakses:

1. **Tambahkan NextAuth.js** — Library sudah tersedia di `package.json`
2. **Implementasi JWT** atau session-based auth
3. **API middleware** yang mengecek authentication pada setiap request
4. **Rate limiting** pada API endpoints

```typescript
// Contoh middleware pattern (belum diimplementasi)
// src/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Check authentication
  // Check authorization  
  // Rate limiting
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
```

---

## API Security

### Input Validation

Semua API routes melakukan input validation:

- **Type checking** — Tipe data divalidasi sebelum diproses
- **Business rule validation** — Risk engine memvalidasi batas trading
- **SQL Injection protection** — Prisma ORM menggunakan parameterized queries
- **No `eval()`** — Tidak ada dynamic code execution

### CORS

Secara default, Next.js API routes hanya menerima same-origin requests. Jika perlu cross-origin:

```typescript
// Tambahkan di next.config.ts jika diperlukan
const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: 'http://localhost:3000' },
        { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE' },
      ]
    }]
  }
}
```

### HTTP Methods

| Method | Penggunaan | Validasi |
|--------|-----------|----------|
| GET | Read data | Query params divalidasi |
| POST | Create/Execute | Body divalidasi (Zod + manual) |
| PUT | Full update | Body divalidasi |
| PATCH | Partial update | Body divalidasi |
| DELETE | Remove | ID divalidasi |

---

## Database Security

### SQLite

| Aspek | Status | Catatan |
|-------|--------|--------|
| File location | `db/custom.db` | Tidak di-commit ke git |
| Backup | Manual | Backup berkala disarankan |
| Encryption | Tidak | SQLite tidak mendukung at-rest encryption |
| Access control | File system | Sama seperti user OS |

### Backup Strategy

```bash
# Backup database (jalankan di VS Code Terminal)
copy db\custom.db db\backup\custom_$(date +%Y%m%d_%H%M%S).db
```

### Data Retention

| Data | Retention | Cleanup |
|------|-----------|---------|
| Trading Logs | Configurable | Auto-cleanup via trading-logger (6h cycle) |
| News Articles | Unlimited | Manual cleanup |
| Candle Data | Unlimited | Manual cleanup |
| Risk Events | Until resolved | Manual atau auto-resolve |
| Audit Trail | Permanent | Jangan hapus |

---

## Broker Connection Security

### MT5 Python Bridge

1. **Local only** — Python bridge hanya berjalan di localhost
2. **Async Mutex** — Semua MT5 calls diserialisasi untuk mencegah race conditions
3. **Circuit Breaker** — Otomatis disconnect jika terlalu banyak failure
4. **Heartbeat** — Monitoring koneksi setiap interval
5. **Error Mapping** — Semua MT5 error codes (10004-10036) ter-map ke remediation

### Rekomendasi MT5

- Gunakan **akun demo** untuk development
- Set **Auto Trading OFF** di MT5 terminal saat tidak digunakan
- Monitor **margin level** secara berkala
- Aktifkan **push notifications** di MT5 untuk margin calls

---

## External API Security

### Finnhub & MARKETAUX

| Aspek | Implementasi |
|-------|---------------|
| **Rate Limiting** | In-memory tracking + DB persistence |
| **Circuit Breaker** | Per-provider: CLOSED → OPEN → HALF_OPEN |
| **Retry** | Exponential backoff untuk transient errors |
| **Failover** | Primary → Secondary provider |
| **Deduplication** | Title-hash based, cross-provider |

### API Key Storage

- API keys disimpan di **environment variables** (`.env`)
- Keys disimpan juga di database (`NewsSourceConfig`) untuk runtime tracking
- Keys **tidak pernah** di-log ke trading logs
- Keys **tidak pernah** dikirim ke client/browser

---

## Input Validation

### Layers of Validation

```
Request
  │
  ▼
Layer 1: HTTP method & route matching (Next.js)
  │
  ▼
Layer 2: Parameter presence & type checking (manual)
  │
  ▼
Layer 3: Business rule validation (risk engine, session rules)
  │
  ▼
Layer 4: Database constraint enforcement (Prisma)
```

### Trade-Specific Validation

Setiap trade opening melewati **6 layer validation**:

1. Session rules (market open? pre-close block?)
2. Pre-trade halt (consecutive loss? equity curve? session risk?)
3. Risk limits (daily loss? margin? position limits? concentration?)
4. Money management (position sizing, reserve capital, scaling)
5. Sentiment filter (extreme sentiment block?)
6. Volatility regime (risk reduction multiplier)

---

## Logging & Monitoring

### Structured Logging

Semua operasi penting di-log ke database dengan:

- **6 severity levels**: DEBUG, INFO, WARN, ERROR, CRITICAL, FATAL
- **11 categories**: MT5_CONNECTION, TRADE_EXECUTION, RISK_MANAGEMENT, MONEY_MANAGEMENT, DATA_FEED, AI_ENGINE, SYSTEM, NOTIFICATION, API_RATE_LIMIT, INDICATOR_POOL, SESSION_MANAGER
- **Fingerprint-based deduplication** — Error identik tidak di-log berulang
- **Audit trail** — Semua perubahan konfigurasi tercatat

### Escalation Pipeline

```
ERROR detected
  → Logged to DB
  → If CRITICAL: Alert sent
  → If FATAL: Recovery attempted
  → If unrecoverable: Emergency action (close all positions)
```

### Sensitive Data di Log

| Data | Di-log? | Catatan |
|------|---------|--------|
| MT5 password | **TIDAK** | Jangan pernah log kredensial |
| API keys | **TIDAK** | Jangan pernah log API keys |
| Trade details | Ya | Simbol, harga, lot size |
| P&L | Ya | Untuk audit dan reporting |
| Error messages | Ya | Termasuk stack trace untuk ERROR+ |

---

## Deployment Security

### Windows 11 Spesifik

| Aspek | Rekomendasi |
|-------|---------------|
| **Windows Defender** | Jangan exclude folder project (kecuali `node_modules` untuk performance) |
| **Windows Firewall** | Block port 3000 dari network (hanya localhost) |
| **User Account** | Gunakan Windows user account yang terpisah untuk trading |
| **Screen Lock** | Set auto-lock (Win+L) saat meninggalkan komputer |
| **Windows Update** | Selalu update ke versi terbaru |
| **BitLocker** | Aktifkan disk encryption untuk laptop |

### Network Security

1. **Jangan expose** port 3000 ke internet tanpa VPN
2. **Gunakan Windows Firewall** untuk block incoming connections
3. **Jangan gunakan** public Wi-Fi untuk trading
4. **Gunakan VPN** jika harus remote access |

### File Permissions

```powershell
# Di PowerShell (Run as Administrator)
# Hanya user yang bisa akses file .env
icacls .env /inheritance:r /grant:r "%USERNAME%:F"

# Hanya user yang bisa akses database
icacls db\custom.db /inheritance:r /grant:r "%USERNAME%:F"
```

---

## Security Checklist

### Pre-Deployment

- [ ] `.env` tidak di-commit ke repository
- [ ] `.gitignore` mengandung `.env*`
- [ ] MT5 menggunakan akun demo untuk testing
- [ ] Semua API keys valid dan aktif
- [ ] Windows Firewall block port 3000 dari network
- [ ] Database backup dijadalwal

### Go-Live

- [ ] Ganti ke akun real MT5
- [ ] Test semua 7 strategi di akun demo
- [ ] Verify risk limits sesuai preferensi
- [ ] Test emergency close functionality
- [ ] Verify audit trail tercatat
- [ ] Set Windows auto-lock
- [ ] Aktifkan BitLocker (laptop)

### Maintenance

- [ ] Rotate MT5 password setiap 90 hari
- [ ] Review risk events mingguan
- [ ] Review audit trail bulanan
- [ ] Backup database sebelum update
- [ ] Update dependencies secara berkala

---

## Vulnerability Reporting

Jika Anda menemukan vulnerability dalam sistem ini:

1. **Jangan** open public issue
2. **Jangan** expose vulnerability ke pihak ketiga
3. Hubungi maintainer langsung
4. Sertakan: langkah reproduksi, impact, dan suggested fix

Vulnerability yang dilaporkan akan ditangani sesuai severity:

| Severity | Response Time | Contoh |
|----------|--------------|--------|
| Critical | 24 jam | Remote code execution, data breach |
| High | 72 jam | Authentication bypass, SQL injection |
| Medium | 1 minggu | Information disclosure |
| Low | 1 bulan | Best practice violation |