# Panduan Kontribusi — FINEX AI Trading System

Terima kasih ingin berkontribusi. Dokumen ini merangkum konvensi proyek agar perubahan konsisten dan aman (sistem ini menangani **dana riil**).

---

## 1. Alur Kerja

1. **Fork/branch** dari `main` (`feat/nama-fitur` atau `fix/deskripsi`).
2. Kembangkan mengikuti konvensi di bawah.
3. Verifikasi mandiri: `bun run lint` + `bunx tsc --noEmit` + uji manual di browser (panel terdampak + mobile 390px).
4. Commit mengikuti [Conventional Commits](https://www.conventionalcommits.org/id/) ringkas:
   - `feat: batch analysis semua pair aktif`
   - `fix: margin quote-currency untuk JPY cross`
   - `docs: tambah SECURITY.md`
   - `chore: pin dependensi engine`
5. **Append worklog** (lihat §5) — bagian dari definisi selesai.
6. Pull request + ringkasan perubahan + hasil verifikasi.

## 2. Lingkungan Development

```bash
bun install
cp .env.example .env        # SESSION_SECRET wajib; ADMIN_PASSWORD untuk dev
bunx prisma db push
bun run dev                 # http://localhost:3000
```

| Perintah | Fungsi |
|---|---|
| `bun run dev` | Dev server (port 3000, log ke `dev.log`) |
| `bun run lint` | ESLint — **wajib 0 error** |
| `bunx tsc --noEmit` | Type-check — **wajib 0 error** (build produksi fail-fast) |
| `bunx prisma db push` | Sinkron skema (setelah edit `prisma/schema.prisma`) |
| `bun run hash-password <pw>` | Generator hash admin |
| `bun run db:backup` | Backup SQLite ter-gzip |

## 3. Konvensi Kode

### 3.1 TypeScript / React
- **Strict TypeScript** — tanpa `any` implisit; tipe bersama di `src/lib/types.ts`.
- **Server vs client**: `'use client'` hanya untuk komponen interaktif; logika data & rahasia tetap di route handler / `'server-only'` module.
- **Komponen**: gunakan primitives `src/components/ui/` (shadcn/ui) & `src/components/shared/` — jangan menulis UI dari nol bila ada padanannya.
- **Panel baru**: ikuti pola panel lama di `src/components/panels/` (judul section `text-xs font-semibold uppercase tracking-wider text-muted-foreground`, card `p-3/p-4`, list panjang `max-h-* overflow-y-auto scrollbar-thin`).

### 3.2 Design system (WAJIB)
- Aksen utama **emerald** — **jangan indigo/blue**.
- BUY/profit `emerald-500/600`, SELL/loss `red-500/600`, warning `amber-500`, netral `zinc/foreground`.
- Angka harga/PnL: `font-mono tabular-nums`.
- Mobile-first: grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, tabel dibungkus `overflow-x-auto`, target sentuh ≥44px.
- Dukung 3 mode kepadatan — hindari ukuran font/padding hard-coded yang mengalahkan `data-density`.

### 3.3 API route
- `export const dynamic = 'force-dynamic'`.
- Validasi input di awal → `400` + pesan **Bahasa Indonesia**.
- Akses data via simulator/service — bukan query Prisma langsung dari panel.
- Endpoint baru otomatis dilindungi proxy gate; bila memang harus publik, ubah matcher `src/proxy.ts` **dengan pertimbangan keamanan** + update [API.md](./API.md) & [SECURITY.md](./SECURITY.md).

### 3.4 Database
- Edit `prisma/schema.prisma` → `bunx prisma db push`.
- Perubahan skema **hanya aditif** (kolom/index baru dengan default) agar versi lama tetap jalan — hindari rename/hapus kolom tanpa migrasi.
- Tipe primitive saja (list disimpan sebagai CSV/JSON string).

### 3.5 Python engine
- Type hints + docstring Bahasa Indonesia (ikuti gaya `app/config.py`).
- Konfigurasi baru: tambahkan ke `app/config.py` (dataclass + yaml + env override) — jangan baca env di file lain.
- Kunci/rahasia **tidak boleh** dikembalikan oleh `to_dict()` atau endpoint settings.
- Verifikasi: `python -m py_compile <file>` + `python main.py --backtest PAIR TF` untuk smoke.

### 3.6 Paritas lintas stack
`src/lib/types.ts` ↔ `python-engine/app/config.py` (`KNOWN_PAIRS` dll.) harus **sinkron**. Menambah pair/TF/indikator = ubah keduanya + `src/lib/constants.ts` (`getPairConfig`: pip size, digits, contract size) + panel Select terkait.

## 4. Aturan Keamanan

- ❌ Jangan pernah commit `.env`, `db/*.db*`, `config.yaml` engine, atau token apa pun.
- ❌ Jangan menonaktifkan proxy gate / rate limit tanpa pengganti setara.
- ✅ Secret baru → `.env.example` (kosong) + dokumentasikan cara generate.
- ✅ Input user selalu divalidasi terhadap daftar known-values.

## 5. Protokol Worklog

Setiap unit kerja (task/fitur/fix) **wajib** menambah section ke [`worklog.md`](./worklog.md) (append, jangan overwrite):

```markdown
---
Task ID: <id, mis. 19-a>
Agent: <nama/kontributor>
Task: <satu baris deskripsi>

Work Log:
- <langkah konkret + hasil verifikasi>

Stage Summary:
- <hasil kunci / keputusan / file berubah>
```

Worklog adalah sumber kebenatan riwayat teknis proyek — tulis apa adanya termasuk kegagalan yang ditemukan (mencegah orang lain tergelincir di tempat yang sama).

## 6. Definisi Selesai (DoD)

- [ ] `bun run lint` & `bunx tsc --noEmit` → 0 error
- [ ] Panel terdampak diuji desktop (1440px) & mobile (390px, tanpa horizontal overflow)
- [ ] Dark & light theme terlihat benar; 3 mode kepadatan tidak rusak
- [ ] Jalur API terdampak diuji (sukses + validasi error)
- [ ] Dokumen terkait di-update (API.md/ARCHITECTURE.md/SECURITY.md bila kontrak berubah)
- [ ] Worklog ter-append
- [ ] Tidak ada secret/DB di diff (`git diff --staged | grep -E "\.env|\.db"`)

## 7. Melaporkan Kerentanan

Jangan buka issue publik untuk celah keamanan. Kirim deskripsi + langkah reproduksi langsung ke pemilik repo secara privat. Sertakan dampak & saran perbaikan bila ada (lihat [SECURITY.md](./SECURITY.md) §5 untuk prosedur respons).
