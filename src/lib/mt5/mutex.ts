// MT5 connection module — async mutex (serializes MT5 API calls).
// Split from src/lib/mt5-connection.ts (v2.1.0 refactor — pure code movement).
// Re-exported unchanged through the facade at src/lib/mt5-connection.ts.

// ============================================
// ASYNC MUTEX
// ============================================

/**
 * Simple async mutex to prevent concurrent MT5 API calls.
 * The MT5 Python module is not thread-safe, so all calls must be serialized.
 */
export class AsyncMutex {
  private _queue: Array<() => void> = []
  private _locked = false

  /** Acquire the mutex lock. Returns a release function. */
  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true
          resolve(this._release)
        } else {
          this._queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }

  /** Run a function exclusively within the mutex lock. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private _release = (): void => {
    this._locked = false
    const next = this._queue.shift()
    if (next) next()
  }

  get locked(): boolean {
    return this._locked
  }

  get queueLength(): number {
    return this._queue.length
  }
}
