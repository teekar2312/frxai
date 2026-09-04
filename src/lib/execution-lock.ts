/**
 * Trade execution lock — global async mutex
 * ===========================================
 * Fixes the check-then-act race condition in the trade opening path.
 *
 * THE BUG (audit finding): preTradeCheck() reads risk state (open positions,
 * daily PnL, margin) from the database, then executeTrade() writes the new
 * trade. Next.js processes requests concurrently, so two simultaneous
 * signals can BOTH pass the risk check before either one has written its
 * trade — busting maxOpenPositions / maxDailyLoss limits that should have
 * blocked the second order.
 *
 * THE FIX: withTradeExecutionLock() serializes the entire
 * read-check → write sequence inside one process-wide promise chain. Both
 * entry points (POST /api/trades/execute and the auto-trading loop) run
 * their check+execute inside this lock, so risk state can never be read
 * while another trade is mid-flight.
 *
 * IMPORTANT LIMITATIONS (documented in PRODUCTION.md):
 * - In-process only. Correct for the single Next.js server process this
 *   app runs as. If you scale horizontally (multiple instances), replace
 *   this with a distributed lock (Redis SETNX / Postgres advisory lock)
 *   at the same call sites.
 * - Held across the broker round-trip (bridge order submit), so trades
 *   intentionally queue — that is the point: risk state must not be read
 *   while an order that will change it is in flight.
 * - NOT reentrant. Never call withTradeExecutionLock from inside a task
 *   that already holds it (no current call site does; both entry points
 *   wrap check+execute as one flat critical section).
 *
 * The chain and busy flag live on globalThis so Next.js dev-mode hot
 * reloads (which re-evaluate modules) do not silently hand out two
 * independent locks.
 */

type GlobalLockState = {
  __frxaiTradeExecChain?: Promise<unknown>
  __frxaiTradeExecBusy?: boolean
}

const g = globalThis as unknown as GlobalLockState

async function runTask<T>(fn: () => Promise<T>): Promise<T> {
  g.__frxaiTradeExecBusy = true
  try {
    return await fn()
  } finally {
    g.__frxaiTradeExecBusy = false
  }
}

/**
 * Run `fn` exclusively on the trade-execution critical section.
 * Callers are serialized in submission order; failures of one task never
 * break the chain for the next.
 */
export function withTradeExecutionLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = g.__frxaiTradeExecChain ?? Promise.resolve()
  const run = previous.then(
    () => runTask(fn),
    () => runTask(fn), // previous task failed — the chain continues regardless
  )
  // Swallow the outcome for the chain itself so one rejection can never
  // wedge every future acquisition.
  g.__frxaiTradeExecChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Diagnostics helper: true while a task holds the lock. */
export function isTradeExecutionLockBusy(): boolean {
  return g.__frxaiTradeExecBusy === true
}
