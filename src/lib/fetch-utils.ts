/**
 * RA-001: Shared fetch utility with AbortController timeout and retry.
 * Used by price-cache, finnhub route, backtest route, and news route.
 * Now logs retries and final failures for observability.
 */

import { safeLog } from './safe-log';

export async function fetchWithTimeout(
  url: string,
  timeoutMs = 8000,
  retries = 2,
  context?: string,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const label = context || url.slice(0, 80);
    const attempt = (tryNum: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      fetch(url, { signal: controller.signal })
        .then((res) => {
          clearTimeout(timer);
          if (res.status === 429 && tryNum < retries) {
            const delay = 1000 * (tryNum + 1);
            safeLog({ level: 'warn', route: 'FetchUtils', message: `429 rate limited, retry ${tryNum + 1}/${retries} in ${delay}ms`, meta: { context: label } });
            setTimeout(() => attempt(tryNum + 1), delay);
            return;
          }
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          if (tryNum < retries) {
            const delay = 500 * (tryNum + 1);
            safeLog({ level: 'warn', route: 'FetchUtils', message: `Fetch failed, retry ${tryNum + 1}/${retries} in ${delay}ms`, error: err instanceof Error ? err.message : String(err), meta: { context: label } });
            setTimeout(() => attempt(tryNum + 1), delay);
            return;
          }
          safeLog({ level: 'error', route: 'FetchUtils', message: `Fetch failed after ${retries + 1} attempts`, error: err instanceof Error ? err.message : String(err), meta: { context: label } });
          reject(err);
        });
    };
    attempt(0);
  });
}
