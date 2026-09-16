/**
 * instrumentation.ts — dijalankan SEKALI saat server Next.js boot
 * (dev maupun produksi standalone).
 *
 * Tugas: aktifkan SQLite WAL + synchronous NORMAL pada database
 * (best-effort, non-fatal bila gagal).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureSqliteWal } = await import('./lib/db')
    await ensureSqliteWal()
  }
}
