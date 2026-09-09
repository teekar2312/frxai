# Panduan Kontribusi — FXQuant AI

Terima kasih telah tertarik berkontribusi pada FXQuant AI! Dokumen ini menjelaskan cara berkontribusi pada proyek.

---

## Daftar Isi

- [Kode Etik](#kode-etik)
- [Cara Memulai](#cara-memulai)
- [Struktur Proyek](#struktur-proyek)
- [Konvensi Kode](#konvensi-kode)
- [Workflow Kontribusi](#workflow-kontribusi)
- [Testing](#testing)
- [Dokumentasi](#dokumentasi)
- [Laporan Bug](#laporan-bug)
- [Permintaan Fitur](#permintaan-fitur)
- [Keamanan](#keamanan)

---

## Kode Etik

Harap baca dan patuhi [Kode Etik](CODE_OF_CONDUCT.md) (jika ada). Ringkasnya:

- Bersikap profesional dan hormat
- Toleransi terhadap pendapat berbeda
- Fokus pada apa yang terbaik untuk komunitas
- Tidak toleran terhadap pelecehan dalam bentuk apapun

---

## Cara Memulai

### Prasyarat

- [Bun](https://bun.sh/) 1.0+ (direkomendasikan) atau Node.js 18+
- Git
- Editor: VS Code (direkomendasikan) dengan ekstensi:
  - ESLint
  - Prettier
  - Tailwind CSS IntelliSense
  - Prisma

### Setup Development

```bash
# 1. Fork & clone repository
git clone https://github.com/<username>/frxai.git
cd frxai

# 2. Tambahkan upstream remote
git remote add upstream https://github.com/teekar2312/frxai.git

# 3. Install dependencies
bun install

# 4. Setup environment
cp .env.example .env
# Edit .env: sesuaikan DATABASE_URL

# 5. Inisialisasi database
bun run db:push

# 6. Jalankan dev server
bun run dev
```

Buka `http://localhost:3000` untuk verifikasi dashboard berjalan.

---

## Struktur Proyek

Lihat [README.md → Struktur Proyek](README.md#struktur-proyek) untuk struktur direktori lengkap.

**Lokasi penting:**
- `src/app/api/` — API routes (Next.js App Router)
- `src/components/sections/` — 9 section komponen dashboard
- `src/components/ui/` — shadcn/ui components (jangan edit, generate via CLI)
- `src/lib/` — Shared utilities, types, store, AI engine
- `prisma/schema.prisma` — Skema database
- `docs/` — Dokumentasi

---

## Konvensi Kode

### TypeScript
- Strict mode (sudah diaktifdi tsconfig.json)
- Gunakan type inference bila memungkinkan, explicit type untuk public API
- Hindari `any` — gunakan `unknown` + type guard, atau definisikan type yang tepat
- Gunakan `interface` untuk object shapes, `type` untuk unions/intersections

```typescript
// Good
interface TradeRow {
  id: string;
  symbol: Pair;
  side: Side;
  // ...
}

// Bad
const trade: any = { ... };
```

### React Components
- Functional components dengan hooks (tidak ada class components)
- `"use client"` directive di komponen yang pakai hooks/event handlers
- Default export untuk page components, named export untuk section components
- Props interface didefinisikan inline atau di types.ts untuk reuse

```typescript
"use client";

import { useState } from "react";

export function MyComponent({ prop }: { prop: string }) {
  const [state, setState] = useState(false);
  return <div>{prop}</div>;
}
```

### Styling (Tailwind CSS 4)
- Gunakan shadcn/ui components yang ada (jangan buat dari scratch)
- Semantic tokens: `bg-card`, `border-border`, `text-muted-foreground`, `text-primary`
- Warna aksen: emerald (profit), rose (loss), amber (warning), violet (AI)
- **DILARANG** menggunakan indigo atau blue
- Class `tnum` untuk angka (tabular-nums)
- Class `scroll-thin` untuk scrollbar custom
- Responsive: mobile-first dengan prefix `sm:`, `md:`, `lg:`, `xl:`

### State Management (Zustand)
- Satu store global di `src/lib/store.ts`
- Gunakan selectors: `useStore((s) => s.field)` untuk minimal re-render
- Jangan mutate state langsung — gunakan setter methods

### API Routes
- `export const dynamic = "force-dynamic"` di semua route
- `export const maxDuration = 60` untuk endpoint yang lambat (AI, backtest)
- Response selalu JSON
- Error handling: try-catch, return `{ error: "message" }` dengan HTTP status code
- Validasi input di server (jangan andalkan client)

### Database (Prisma)
- Edit `prisma/schema.prisma` untuk perubahan schema
- Jalankan `bun run db:push` untuk apply changes
- Gunakan `import { db } from "@/lib/db"` untuk akses Prisma client
- Transaction untuk multi-table operations

### Naming Conventions
- **Files:** kebab-case (`ai-section.tsx`, `server-config.ts`)
- **Components:** PascalCase (`AiSection`, `TradingShell`)
- **Functions:** camelCase (`runAnalysis`, `handleMt5Connect`)
- **Types/Interfaces:** PascalCase (`TradeRow`, `AiAnalysisResult`)
- **Constants:** UPPER_SNAKE_CASE (`PAIRS`, `TIMEFRAMES`, `BROKER_SPEC`)
- **CSS classes:** kebab-case via Tailwind

### Bahasa
- **UI labels & descriptions:** Bahasa Indonesia
- **Code identifiers (variable, function names):** English
- **Komentar:** Bahasa Indonesia atau English (konsisten per file)
- **Dokumentasi:** Bahasa Indonesia

---

## Workflow Kontribusi

### 1. Buat Branch

```bash
git checkout -b feature/nama-fitur
# atau
git checkout -b fix/nama-bug
```

**Branch naming:**
- `feature/` — fitur baru
- `fix/` — bug fix
- `docs/` — dokumentasi
- `refactor/` — refactoring
- `chore/` — maintenance, dependency updates

### 2. Develop

- Buat perubahan dalam commit kecil dan atomik
- Setiap commit harus self-contained dan passing lint
- Commit message format:

```
type(scope): deskripsi singkat

<body opsional, jelaskan what & why, bukan how>
```

**Type:** `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `style`
**Scope:** area yang diubah (mis. `ai`, `trading`, `mt5`, `risk`, `ui`)

**Contoh:**
```
feat(ai): tambah analisa paralel untuk semua pair aktif
fix(mt5): validasi nomor akun 4-12 digit di connect endpoint
docs(api): tambah dokumentasi endpoint /api/mt5/start-terminal
refactor(store): pecah store jadi selectors untuk performance
```

### 3. Verifikasi

```bash
# Lint
bun run lint

# Type check
bunx tsc --noEmit

# Test manual via browser
bun run dev
# Verifikasi fitur/fix di http://localhost:3000
```

Pastikan:
- [ ] Lint passing (0 errors)
- [ ] Type check passing
- [ ] Fitur berfungsi di browser
- [ ] Responsive (mobile + desktop)
- [ ] Dark + light theme
- [ ] Tidak ada console errors

### 4. Commit & Push

```bash
git add -A
git commit -m "feat(scope): deskripsi"
git push origin feature/nama-fitur
```

### 5. Pull Request

Buka Pull Request ke `upstream/main` dengan template:

```markdown
## Deskripsi
Jelaskan apa yang diubah dan mengapa.

## Tipe Perubahan
- [ ] Bug fix (non-breaking)
- [ ] Fitur baru (non-breaking)
- [ ] Breaking change (fix atau fitur yang menyebabkan fitur existing tidak berfungsi)

## Checklist
- [ ] Lint passing
- [ ] Type check passing
- [ ] Test manual dilakukan
- [ ] Dokumentasi diupdate (jika perlu)
- [ ] Tidak ada file sensitif (.env, db/custom.db) yang ter-commit

## Screenshot (jika ada)
```

---

## Testing

Saat ini proyek belum memiliki unit test otomatis. Kontribusi untuk setup testing (Jest/Vitest + Testing Library) diterima.

**Manual testing checklist:**
- [ ] Dashboard load tanpa error
- [ ] Semua 9 section bisa di-navigate
- [ ] MT5 connect/disconnect flow
- [ ] Place & close trade
- [ ] AI analysis (real LLM call)
- [ ] Backtest run
- [ ] Alert create & delete
- [ ] Settings save (trading, risk, keys, MT5)
- [ ] Dark/light theme toggle
- [ ] Mobile responsive

---

## Dokumentasi

### Kapan update dokumentasi?
- **API change:** update `docs/API.md`
- **New indicator:** update `docs/INDICATORS.md`
- **Risk rule change:** update `docs/RISK-MANAGEMENT.md`
- **Architecture change:** update `docs/ARCHITECTURE.md`
- **New feature:** update `README.md` + `docs/CHANGELOG.md`

### Format
- Markdown
- Bahasa Indonesia untuk deskripsi
- Code blocks dengan syntax highlighting
- Tabel untuk data terstruktur
- Tidak menggunakan emoji

---

## Laporan Bug

Buka [GitHub Issue](https://github.com/teekar2312/frxai/issues/new) dengan label `bug`:

```markdown
**Deskripsi Bug**
Jelaskan bug dengan jelas.

**Langkah Reproduce**
1. Buka '...'
2. Klik '...'
3. Lihat error

**Expected Behavior**
Apa yang seharusnya terjadi.

**Actual Behavior**
Apa yang terjadi.

**Environment**
- OS: [mis. Windows 11, macOS 14]
- Browser: [mis. Chrome 120]
- Version: [mis. 1.0.0]

**Screenshot**
(jika ada)

**Logs**
```
paste dev.log / console error di sini
```
```

---

## Permintaan Fitur

Buka [GitHub Issue](https://github.com/teekar2312/frxai/issues/new) dengan label `enhancement`:

```markdown
**Fitur yang Diminta**
Jelaskan fitur dan use case-nya.

**Motivasi**
Mengapa fitur ini dibutuhkan? Problem apa yang diselesaikan?

**Solusi yang Diusulkan**
Bagaimana implementasinya (jika ada ide).

**Alternatif yang Dipertimbangkan**
Solusi lain yang pernah dipertimbangkan.

**Additional Context**
Screenshot, mockup, referensi.
```

---

## Keamanan

### File Sensitif (JANGAN PERNAH COMMIT)
- `.env` — berisi DATABASE_URL
- `db/custom.db` — berisi MT5 credentials, API keys
- `worklog.md` — catatan internal
- `agent-ctx/` — catatan internal

Jika tidak sengaja commit file sensitif:
1. JANGAN push ke remote
2. `git rm --cached <file>` untuk untrack
3. Tambahkan ke `.gitignore` jika belum
4. Jika sudah ter-push, hubungi maintainer untuk purge dari history

### Vulnerability Disclosure
Jika menemukan vulnerability keamanan:
1. JANGAN buka public issue
2. Email maintainer secara privat
3. Berikan detail reproducibility
4. Tunggu fix sebelum publish

### PAT (Personal Access Token)
- Jangan pernah commit PAT ke file atau git config
- Jangan share PAT di chat/email
- Gunakan PAT sekali untuk push, lalu hapus dari remote URL
- Revoke PAT yang pernah ter-expose

---

## Pertanyaan?

- Buka [GitHub Discussions](https://github.com/teekar2312/frxai/discussions) untuk Q&A
- Buka [GitHub Issues](https://github.com/teekar2312/frxai/issues) untuk bug/feature request
- Baca dokumentasi lengkap di `docs/`

Terima kasih atas kontribusi Anda!
