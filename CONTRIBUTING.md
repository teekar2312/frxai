# Contributing

> Panduan kontribusi untuk FINEX AI Trader

---

## Daftar Isi

- [Overview](#overview)
- [Development Environment](#development-environment)
- [Coding Standards](#coding-standards)
- [Project Structure](#project-structure)
- [Git Workflow](#git-workflow)
- [Pull Request Process](#pull-request-process)
- [Code Review Checklist](#code-review-checklist)
- [Testing Guidelines](#testing-guidelines)
- [Commit Messages](#commit-messages)
- [Documentation](#documentation)

---

## Overview

FINEX AI Trader adalah proyek **private** dan **proprietary**. Kontribusi hanya diterima dari maintainer yang ditunjuk. Panduan ini berfungsi sebagai coding standard reference.

---

## Development Environment

### Prasyarat

| Software | Versi | Keterangan |
|----------|-------|------------|
| Windows 11 | 22H2+ | OS utama |
| VS Code | 1.85+ | IDE utama |
| Bun | 1.3.x | JavaScript runtime |
| Git | 2.40+ | Version control |

### Setup

```bash
# 1. Clone dan install
git clone <repository-url>
cd frxai
bun install

# 2. Setup environment
copy .env.example .env
# Edit .env sesuai konfigurasi

# 3. Setup database
bun run db:generate
bun run db:push

# 4. Jalankan dev server
bun run dev
```

### VS Code Workspace Settings

Rekomendasi setting di `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "tailwindCSS.experimental.classRegex": [
    ["className=\"([^\"]*)\""]
  ]
}
}
```

---

## Coding Standards

### TypeScript

- **Strict mode** — Semua file menggunakan TypeScript strict
- **No `any`** — Gunakan tipe yang spesifik atau `unknown`
- **Explicit return types** — Untuk fungsi public/exported
- **Interface over type** — Untuk object shapes, gunakan `interface`

### File Naming

| Tipe | Convention | Contoh |
|------|-----------|-------|
| Komponen React | PascalCase | `TradingPositions.tsx` |
| Utility modules | kebab-case | `trading-logger.ts` |
| API routes | kebab-case | `trading-execution-engine.ts` |
| Types/Interfaces | PascalCase | `TradeStatus` |
| Constants | UPPER_SNAKE | `SYMBOL_MAP` |

### Imports

```typescript
// 1. External libraries
import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'

// 2. Internal modules
import { getTradingPhase } from '@/lib/mt5-connection'

// 3. Types (dari file yang sama)
import type { TradingPhase } from '@/lib/mt5-connection'
```

### Comments

```typescript
/**
 * Deskripsi fungsi (JSDoc style)
 * @param name - Deskripsi parameter
 * @returns Deskripsi return value
 */
function example(name: string): string {
  // Inline comment untuk kode yang tidak obvious
  return name
}

// Section separator untuk file yang panjang
// ============================================
// SECTION NAME
// ============================================
```

### React Components

- Gunakan **functional components** dengan hooks
- Gunakan **shadcn/ui** untuk semua UI components
- Gunakan **`'use client'`** hanya jika diperlukan
- Komponen trading di `src/components/trading/`
- Komponen UI reusable di `src/components/ui/`

---

## Project Structure

```
src/
├── app/
│   ├── api/          # API routes — SEMUA business logic di sini
│   ├── page.tsx      # Main page (client component)
│   └── layout.tsx    # Root layout (server component)
├── components/
│   ├── trading/      # Domain-specific trading components
│   └── ui/           # Generic shadcn/ui components (JANGAN edit manual)
├── hooks/           # Custom React hooks
└── lib/             # Core business logic modules
```

### Important Rules

1. **Business logic di API routes** — Jangan letakkan trading logic di client
2. **Jangan edit `src/components/ui/`** — Gunakan shadcn CLI: `bunx shadcn@latest add <component>`
3. **`z-ai-web-dev-sdk` hanya di backend** — Tidak boleh di client-side code
4. **Database access hanya via `db`** dari `src/lib/db.ts`

---

## Git Workflow

### Branching

| Branch | Penggunaan |
|--------|-----------|
| `main` | Production-ready code |
| `feature/*` | Fitur baru |
| `fix/*` | Bug fix |
| `audit/*` | Audit & optimization pass |

### Workflow

```bash
# 1. Buat branch baru dari main
git checkout main
git pull
git checkout -b feature/nama-fitur

# 2. Development
bun run dev
bun run lint  # Pastikan 0 errors, 0 warnings

# 3. Commit dengan pesan yang deskriptif
git add .
git commit -m "feat: deskripsi perubahan"

# 4. Push
git push origin feature/nama-fitur

# 5. Merge ke main (setelah review)
git checkout main
git merge feature/nama-fitur
```

---

## Pull Request Process

### Sebelum Membuat PR

1. `bun run lint` — 0 errors, 0 warnings
2. Test manual semua fitur yang terpengaruh
3. Tidak ada `console.log` di production code
4. Tidak ada TODO/FIXME yang tidak perlu
5. Dokumentasi terupdate jika diperlukan

### PR Description Template

```markdown
## Perubahan
- Deskripsi singkat perubahan

## Mengapa
- Alasan/background perubahan

## Cara Test
1. Buka halaman X
2. Klik Y
3. Verifikasi Z

## Impact
- Trade execution: [Yes/No]
- Risk management: [Yes/No]
- Database schema: [Yes/No]
- Breaking changes: [Yes/No]
```

---

## Code Review Checklist

### General

- [ ] Code mengikuti coding standards
- [ ] Tidak ada dead code atau commented-out code
- [ ] Tidak ada `console.log` (kecuali di error handler)
- [ ] Error handling lengkap (try/catch + logging)
- [ ] Tidak ada hardcoded values yang seharusnya di config

### Trading-Specific

- [ ] Trade state changes menggunakan atomic `updateMany`
- [ ] WIB timezone pattern digunakan (`Intl.DateTimeFormat`)
- [ ] Race condition diperhitungkan
- [ ] Risk check dilakukan sebelum trade execution
- [ ] Audit trail tercatat untuk perubahan konfigurasi

### Performance

- [ ] Database query tidak N+1 (gunakan `include` atau batch)
- [ ] Tidak ada query tanpa `where` clause (full table scan)
- [ ] Cache digunakan untuk data yang sering diakses
- [ ] In-memory state tidak leak (FIFO eviction)

### Security

- [ ] Tidak ada kredensial di code
- [ ] Input validation lengkap
- [ ] SQL injection tidak mungkin (Prisma parameterized)
- [ ] Sensitive data tidak di-log

---

## Testing Guidelines

### Manual Testing Checklist

Saat mengubah modul trading, test:

1. **MT5 Connection** — Connect → heartbeat → disconnect → reconnect
2. **Trade Open** — Buat trade, verifikasi DB record
3. **Trade Close** — Close trade, verifikasi P&L calculation
4. **SL/TP** — Test price update yang trigger SL dan TP
5. **Trailing Stop** — Test trailing adjustment
6. **Risk Check** — Test daily limit rejection
7. **Emergency Close** — Test close all positions

### Linting

```bash
# Jalankan sebelum setiap commit
bun run lint

# Harus: 0 errors, 0 warnings
```

---

## Commit Messages

### Format

```
<type>: <deskripsi singkat>

<detail opsional>
```

### Types

| Type | Penggunaan |
|------|-----------|
| `feat` | Fitur baru |
| `fix` | Bug fix |
| `refactor` | Refactoring tanpa perubahan behavior |
| `docs` | Perubahan dokumentasi |
| `style` | Formatting (tanpa logic change) |
| `perf` | Performance improvement |
| `audit` | Audit pass & fixes |
| `chore` | Maintenance (deps, config) |

### Contoh

```
feat: add tiered trailing stop support

fix: correct WIB date conversion in session performance tracking
audit: deep audit pass on risk engine — 12 improvements applied
docs: update API.md with new endpoints
```