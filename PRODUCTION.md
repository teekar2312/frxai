# PRODUCTION.md — Kesiapan Produksi & Jalur Migrasi

> Dokumen ini menjawab pertanyaan: **apa saja yang harus berubah sebelum sistem ini
> boleh dipakai untuk trading uang nyata?** Setiap bagian menjelaskan status saat ini,
> risikonya, dan langkah migrasinya.

---

## 1. Broker Bridge: Simulator vs Produksi

| Mode | Implementasi | Kapan dipakai |
|------|--------------|---------------|
| **Dev/Demo** | `mini-services/mt5-bridge/` (TypeScript/Bun) — simulator: harga random-walk, fill order fake, tanpa koneksi broker | Pengembangan, demo UI, testing |
| **Produksi** | `python-bridge/mt5_bridge.py` (FastAPI + library resmi `MetaTrader5`) | Trading nyata — butuh Windows + terminal MT5 dengan Algo Trading aktif |

Kedua bridge berbicara **kontrak HTTP yang identik** (12 endpoint, envelope
`{success, data}` / `{success, false, error...}`, heartbeat 401 = alive-not-connected),
jadi pergantian hanya: matikan simulator → jalankan Python bridge di port yang sama
(3001). Aplikasi Next.js tidak perlu diubah sama sekali.

**Sebelum go-live:** jalankan bridge Python di mesin Windows + akun demo MT5
terlebih dahulu, verifikasi 12 endpoint via `python-bridge/README.md`, baru
pertimbangkan akun live.

## 2. Database: SQLite → PostgreSQL

**Status:** SQLite (WAL mode + busy_timeout 5s aktif — lihat `src/lib/db.ts`).

**Mengapa cukup untuk dev/demo:** satu proses server, konkurensi rendah, workload
read-heavy. WAL menghilangkan reader-blocks-writer.

**Mengapa harus migrasi untuk produksi:** SQLite tetap punya **single-writer**
semantics; pada saat volatility tinggi (logging + price update + eksekusi order +
risk check bersamaan), antrean tulisan bisa menambah latensi eksekusi.

**Langkah migrasi:**

1. `prisma/schema.prisma`: ganti `provider = "sqlite"` → `"postgresql"`,
   `url = env("DATABASE_URL")` (DSN PostgreSQL).
2. Sesuaikan tipe field yang berbeda semantics di PG (`String` → `DateTime` untuk
   kolom waktu, dsb.) — jalankan `bunx prisma validate` iteratif sampai bersih.
3. Migrasi data: `bunx prisma db pull` tidak berlaku (beda engine) — ekspor via
   skrip kecil (baca SQLite → insert ke PG per model, urutkan dependensi relasi).
4. `bunx prisma migrate dev --name init-pg` di environment PG.
5. Jalankan ulang test suite (DB-dependent tests perlu fixture PG).

## 3. Race Condition: In-Process Lock → Distributed Lock

**Status:** `src/lib/execution-lock.ts` — mutex global in-process. Seluruh path
`preTradeCheck()` (baca state risiko) → `executeTrade()` (tulis trade) kini
berjalan eksklusif: dua sinyal bersamaan tidak bisa lolos keduanya dari validasi
risk. Cakupan: POST `/api/trades/execute` + auto-trading loop.

**Batasan:** benar hanya selama aplikasi berjalan sebagai **satu proses Next.js**
(mode default). Horizontal scaling (multi-instance / cluster) membuat tiap instance
punya lock sendiri → perlombaan antar-instance kembali terbuka.

**Jika scale-out:** ganti isi `withTradeExecutionLock()` dengan lock terdistribusi
(Redis `SET key NX PX <ttl>` dengan renew, atau `pg_advisory_xact_lock` bila sudah
migrasi PostgreSQL) — call site tidak berubah, kontrak fungsi tetap.

## 4. Secrets & Enkripsi

**Status:** `botToken` (Telegram) dan `webhookUrl` (Discord) dienkripsi
AES-256-GCM sebelum disimpan ke DB (`src/lib/secret-crypto.ts`), envelope
`enc:v1:<iv>:<tag>:<ct>`. Row plaintext lama otomatis lolos (backward-compat) dan
terenkripsi saat berikutnya disimpan ulang.

**Wajib sebelum produksi:**

1. Set `NOTIFICATION_ENCRYPTION_KEY` (32 byte, hex/base64 — `openssl rand -hex 32`).
   **Tanpa env ini, kunci dev-fallback dipakai** (ada warning saat startup) —
   fallback tersebut TIDAK aman untuk produksi.
2. Rotasi kunci: nilai `enc:v1:` lama menjadi undecryptable (channel akan
   menandai `lastError` dan dinonaktifkan) — re-input kredensial setelah rotasi.
3. `MT5_PASSWORD` dan kunci API berita tetap via environment variables — jangan
   pernah commit `.env` (sudah ter-ignore, hanya `.env.example` yang terlacak).

## 5. Runtime & Versi Stack

| Komponen | Versi terkunci | Catatan |
|----------|----------------|---------|
| Next.js | 16.x (App Router) | Stabil dan berjalan di environment ini; jangan turunkan hanya karena referensi eksternal usang — verifikasi terhadap changelog resmi |
| TypeScript | 5.x strict | `tsc --noEmit` = 0 error di CI |
| Bun | 1.3.x | Runtime dev + test runner; produksi bisa Node.js LTS jika preferensi ekosistem |
| Prisma | 6.x | — |
| Tailwind CSS | 4.x | — |

Aturan: setiap upgrade versi besar dijalankan **bersama full test suite**
(477+ test) + smoke test bridge kontrak sebelum merge.

## 6. Dependensi Eksternal (Finnhub / Marketaux)

**Status:** sudah self-healing — kegagalan fetch berita/sentimen ditangkap
circuit breaker + fallback `defaultNewsFactors()` (netral), sehingga decision
engine otomatis degradasi ke **technical-only** tanpa intervensi manual.
`breakingNewsCount` exception → 0. Diverifikasi di `src/lib/ai/news-analysis.ts`.

Kunci API wajib di-set; tanpa kunci, modul berjalan netral (bukan crash).

## 7. Checklist Go-Live

- [ ] Bridge Python berjalan di Windows + MT5 akun **demo** — 12 endpoint lulus smoke test
- [ ] Migrasi PostgreSQL selesai (bagian 2) — `prisma migrate` bersih
- [ ] `NOTIFICATION_ENCRYPTION_KEY` ter-set (bukan dev fallback — cek log startup)
- [ ] Lock terdistribusi jika multi-instance (bagian 3)
- [ ] Supervisor/watchdog aktif untuk bridge Python (resep: `mini-services/mt5-bridge/supervisor.ts` bisa diadaptasi, atau Windows Service)
- [ ] Backup DB terjadwal + prosedur restore pernah diuji
- [ ] Test suite penuh hijau + E2E browser manual di tab Live Trading & Risk
- [ ] Akun live: mulai dari lot terkecil, pantau `consecutiveErrors` + risk events di System Health

---

*Terakhir diperbarui: v2.1.1 — hasil audit eksternal (race condition, secrets,
simulator bridge) seluruhnya ditangani/didokumentasikan.*
