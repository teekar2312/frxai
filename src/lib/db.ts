import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __finexWalApplied?: boolean
}

/**
 * Prisma client singleton.
 *
 * Produksi: log hanya error (query log = noise + potensi bocor data di log).
 * Development: log query untuk debugging.
 */
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Aktifkan WAL (Write-Ahead Logging) SQLite — best-effort, sekali per proses:
 *  - pembaca tidak diblokir penulis (polling /api/engine tiap 2s aman)
 *  - lebih tahan terhadap korupsi saat crash
 * Setelan WAL bersifat persisten pada file DB.
 */
export async function ensureSqliteWal(): Promise<void> {
  if (globalForPrisma.__finexWalApplied) return
  globalForPrisma.__finexWalApplied = true
  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
    await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL;')
  } catch (e) {
    console.warn('[db] Gagal set WAL mode (non-fatal):', e instanceof Error ? e.message : e)
  }
}
