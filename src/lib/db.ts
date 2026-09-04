import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  /** Resolves once the one-time SQLite hardening pragmas have been applied. */
  prismaSqliteReady?: Promise<void>
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * SQLite hardening (audit finding: "database is locked" risk under
 * concurrent writes — logging + price updates + order execution + risk
 * checks all hit the same file).
 *
 *   journal_mode=WAL   — writers no longer block readers (and vice versa);
 *                        the mode persists in the database file, so this
 *                        only needs to succeed once, ever.
 *   busy_timeout=5000  — a writer waiting for the (single) write lock retries
 *                        for up to 5s instead of failing immediately with
 *                        SQLITE_BUSY. Applied per connection; best effort.
 *
 * Fire-and-forget on first import: queries issued before the pragmas land
 * simply run with the previous settings. Failures are swallowed — a
 * read-only filesystem or a locked database must never crash module load.
 */
export const sqliteReady: Promise<void> =
  globalForPrisma.prismaSqliteReady ??
  (globalForPrisma.prismaSqliteReady = (async () => {
    try {
      await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
      await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
    } catch {
      // Best effort only — see note above.
    }
  })())

// Kick off the pragma initialization eagerly.
void sqliteReady
