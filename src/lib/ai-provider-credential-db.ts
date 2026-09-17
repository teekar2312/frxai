/**
 * ai-provider-credential-db.ts — Lapisan data TANGGUH untuk AiProviderCredential (server-only).
 *
 * Latar belakang insiden (berulang): runtime sandbox sesekali me-restore
 * proses/node_modules dari snapshot lama sehingga Prisma Client yang termuat
 * di memori TIDAK mengenal model `AiProviderCredential` (aksesor undefined)
 * → "Cannot read properties of undefined (reading 'upsert'/'findMany')"
 * meskipun tabel di SQLite sudah ada dan client di disk sudah benar.
 *
 * Strategi dua jalur:
 *  1. Jalur utama: model Prisma `db.aiProviderCredential` (typed).
 *  2. Fallback: raw SQL parameterized via `$queryRawUnsafe`/`$executeRawUnsafe`
 *     — API inti yang ADA di SEMUA versi Prisma Client — langsung ke tabel.
 *     DateTime disimpan sebagai INTEGER epoch-millis, format PERSIS yang
 *     dipakai Prisma (diverifikasi empiris terhadap DB berjalan), sehingga:
 *       - baris yang ditulis jalur fallback terbaca sempurna oleh Prisma
 *         Client sehat (setelah `prisma generate` + restart), dan
 *       - baris buatan Prisma terbaca benar oleh fallback ini.
 *     Interoperabilitas dua arah = tidak ada data "yatim".
 *
 * Keamanan: semua nilai di-bind sebagai parameter `?` — tidak pernah ada
 * interpolasi string nilai ke SQL. Nama kolom pada statement berasal dari
 * kode (bukan input user).
 *
 * Escape hatch diagnostik: set `FINEX_AI_CRED_FORCE_RAW=1` di .env untuk
 * memaksa jalur raw SQL (menguji fallback tanpa menunggu client stale).
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

export interface AiCredentialRow {
  provider: string
  apiKeyEnc: string | null
  baseUrl: string | null
  model: string | null
  status: string
  lastError: string | null
  testedAt: Date | null
}

/** Field yang boleh di-upsert (Partial — hanya yang disertakan yang diubah). */
export type AiCredentialUpsertFields = Partial<{
  apiKeyEnc: string | null
  baseUrl: string | null
  model: string | null
  status: string
  lastError: string | null
  testedAt: Date | null
}>

/** Tampilan minimal model Prisma yang dibutuhkan (kompatibel subset). */
type CredentialModelLike = {
  findUnique: (args: { where: { provider: string } }) => Promise<AiCredentialRow | null>
  findMany: () => Promise<AiCredentialRow[]>
  upsert: (args: {
    where: { provider: string }
    create: Record<string, unknown>
    update: Record<string, unknown>
  }) => Promise<unknown>
  deleteMany: (args: { where: { provider: string } }) => Promise<unknown>
}

interface RawCredentialRow {
  provider: string | number
  apiKeyEnc: string | null
  baseUrl: string | null
  model: string | null
  status: string | number | null
  lastError: string | null
  testedAt: number | string | Date | null
}

const warned = new Set<string>()
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[ai-cred-db] ${msg}`)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Model Prisma bila tersedia di runtime; null → pakai raw SQL. */
function credentialModel(): CredentialModelLike | null {
  if (process.env.FINEX_AI_CRED_FORCE_RAW === '1') {
    warnOnce(
      'force-raw',
      'FINEX_AI_CRED_FORCE_RAW=1 — jalur raw SQL dipaksa (mode diagnostik, abaikan model Prisma).',
    )
    return null
  }
  const m = (db as unknown as { aiProviderCredential?: CredentialModelLike }).aiProviderCredential
  if (!m) {
    warnOnce(
      'stale-client',
      'Model Prisma `aiProviderCredential` tidak tersedia di client runtime (stale) — memakai fallback raw SQL. ' +
        'Saran: `bunx prisma generate` lalu restart server agar kembali ke jalur typed.',
    )
  }
  return m ?? null
}

/** Konversi nilai DateTime SQLite (epoch-ms int / string / Date) → Date. */
function toDate(v: number | string | Date | null | undefined): Date | null {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date(v)
  const s = v.trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isNaN(n)) return new Date(n) // "1789617600123"
  // Format teks (mis. hasil restore/manual): normalisasi ke ISO UTC.
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + (/[Z+\-]\d\d:?\d\d$/.test(s) ? '' : 'Z')
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t)
}

function normalizeRow(r: RawCredentialRow): AiCredentialRow {
  return {
    provider: String(r.provider),
    apiKeyEnc: r.apiKeyEnc ?? null,
    baseUrl: r.baseUrl ?? null,
    model: r.model ?? null,
    status: typeof r.status === 'string' ? r.status : String(r.status ?? 'untested'),
    lastError: r.lastError ?? null,
    testedAt: toDate(r.testedAt),
  }
}

const SQL_SELECT_COLS = '"provider", "apiKeyEnc", "baseUrl", "model", "status", "lastError", "testedAt"'

/** Semua baris kredensial (tanpa id/timestamp lain — tidak dibutuhkan caller). */
export async function listCredentialRows(): Promise<AiCredentialRow[]> {
  const model = credentialModel()
  if (model) {
    try {
      return await model.findMany()
    } catch (e) {
      warnOnce('findMany-fail', `findMany Prisma gagal (${errorMessage(e)}) — mencoba fallback raw SQL.`)
    }
  }
  const raw = await db.$queryRawUnsafe<RawCredentialRow[]>(
    `SELECT ${SQL_SELECT_COLS} FROM "AiProviderCredential"`,
  )
  return raw.map(normalizeRow)
}

/** Satu baris berdasarkan provider (null bila tidak ada). */
export async function getCredentialRow(provider: string): Promise<AiCredentialRow | null> {
  const model = credentialModel()
  if (model) {
    try {
      return await model.findUnique({ where: { provider } })
    } catch (e) {
      warnOnce('findUnique-fail', `findUnique Prisma gagal (${errorMessage(e)}) — mencoba fallback raw SQL.`)
    }
  }
  const raw = await db.$queryRawUnsafe<RawCredentialRow[]>(
    `SELECT ${SQL_SELECT_COLS} FROM "AiProviderCredential" WHERE "provider" = ?`,
    provider,
  )
  return raw.length > 0 ? normalizeRow(raw[0]) : null
}

/**
 * Upsert satu provider. Hanya field yang disertakan yang ditulis/diubah
 * (semantik Partial — sama seperti `update` Prisma). Baris baru selalu
 * mendapat id (UUID) + updatedAt/createdAt (epoch-ms).
 */
export async function upsertCredential(
  provider: string,
  fields: AiCredentialUpsertFields,
): Promise<void> {
  const model = credentialModel()
  if (model) {
    try {
      await model.upsert({
        where: { provider },
        create: { provider, ...fields },
        update: { ...fields },
      })
      return
    } catch (e) {
      warnOnce('upsert-fail', `Upsert Prisma gagal (${errorMessage(e)}) — mencoba fallback raw SQL.`)
    }
  }

  const cols = ['"id"', '"provider"', '"updatedAt"', '"createdAt"']
  const vals: unknown[] = [randomUUID(), provider, Date.now(), Date.now()]
  const sets = ['"updatedAt" = excluded."updatedAt"']
  for (const [key, value] of Object.entries(fields)) {
    cols.push(`"${key}"`)
    vals.push(key === 'testedAt' ? (value instanceof Date ? value.getTime() : null) : (value ?? null))
    sets.push(`"${key}" = excluded."${key}"`)
  }
  const placeholders = cols.map(() => '?').join(', ')
  const sql =
    `INSERT INTO "AiProviderCredential" (${cols.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT("provider") DO UPDATE SET ${sets.join(', ')}`
  await db.$executeRawUnsafe(sql, ...vals)
}

/** Hapus semua baris untuk provider (no-op bila tidak ada). */
export async function deleteCredential(provider: string): Promise<void> {
  const model = credentialModel()
  if (model) {
    try {
      await model.deleteMany({ where: { provider } })
      return
    } catch (e) {
      warnOnce('delete-fail', `deleteMany Prisma gagal (${errorMessage(e)}) — mencoba fallback raw SQL.`)
    }
  }
  await db.$executeRawUnsafe('DELETE FROM "AiProviderCredential" WHERE "provider" = ?', provider)
}
