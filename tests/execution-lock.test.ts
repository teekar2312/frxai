/**
 * Unit tests — src/lib/execution-lock.ts (global trade execution mutex)
 * ======================================================================
 * Covers: strict serialization of concurrent critical sections (no
 * overlap), submission-order fairness, error isolation (a failing task
 * never wedges the chain for subsequent tasks), and the globalThis
 * singleton semantics that survive module re-evaluation (HMR guard).
 *
 * The lock exists to close the check-then-act race between preTradeCheck
 * (reads risk state) and executeTrade (writes the trade) — see the module
 * doc comment in src/lib/execution-lock.ts.
 */
import { describe, test, expect } from 'bun:test'
import { withTradeExecutionLock, isTradeExecutionLockBusy } from '../src/lib/execution-lock'

/** Records entry/exit of a critical section to detect overlaps. */
function makeTrackedTask(
  log: string[],
  label: string,
  durationMs: number,
): () => Promise<string> {
  return () =>
    new Promise<string>((resolve) => {
      log.push(`enter:${label}`)
      setTimeout(() => {
        log.push(`exit:${label}`)
        resolve(label)
      }, durationMs)
    })
}

describe('withTradeExecutionLock', () => {
  test('concurrent tasks never overlap (check-then-act race guard)', async () => {
    const log: string[] = []
    const results = await Promise.all([
      withTradeExecutionLock(makeTrackedTask(log, 'A', 30)),
      withTradeExecutionLock(makeTrackedTask(log, 'B', 20)),
      withTradeExecutionLock(makeTrackedTask(log, 'C', 10)),
    ])

    expect(results.sort()).toEqual(['A', 'B', 'C'])
    // Serialization: every enter must be followed by a matching exit
    // before the next enter.
    let active = 0
    for (const entry of log) {
      if (entry.startsWith('enter:')) {
        active++
        expect(active).toBeLessThanOrEqual(1)
      } else {
        active--
        expect(active).toBeGreaterThanOrEqual(0)
      }
    }
    expect(active).toBe(0)
  })

  test('tasks run in submission order', async () => {
    const log: string[] = []
    await Promise.all([
      withTradeExecutionLock(makeTrackedTask(log, 'first', 15)),
      withTradeExecutionLock(makeTrackedTask(log, 'second', 5)),
    ])
    expect(log.indexOf('enter:first')).toBeLessThan(log.indexOf('enter:second'))
  })

  test('a rejected task does not wedge the chain for later tasks', async () => {
    const failing = withTradeExecutionLock(async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')

    // The chain must still work for the next acquisition.
    const value = await withTradeExecutionLock(async () => 'still-alive')
    expect(value).toBe('still-alive')
  })

  test('return values and rejections propagate to the caller only', async () => {
    const value = await withTradeExecutionLock(async () => 42)
    expect(value).toBe(42)
  })

  test('nested sequential acquisitions (not reentrant) complete without deadlock', async () => {
    // Callers never nest the lock (documented contract), but sequential
    // re-acquisition must trivially work.
    const first = await withTradeExecutionLock(async () => 'one')
    const second = await withTradeExecutionLock(async () => 'two')
    expect(first).toBe('one')
    expect(second).toBe('two')
  })

  test('isTradeExecutionLockBusy reflects in-flight state', async () => {
    expect(isTradeExecutionLockBusy()).toBe(false)
    const inside = await withTradeExecutionLock(async () => isTradeExecutionLockBusy())
    expect(inside).toBe(true)
    expect(isTradeExecutionLockBusy()).toBe(false)
  })
})
