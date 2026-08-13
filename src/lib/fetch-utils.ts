/**
 * RA-001: Shared fetch utility with AbortController timeout and retry.
 * Used by price-cache, finnhub route, backtest route, and news route.
 */

export async function fetchWithTimeout(
  url: string,
  timeoutMs = 8000,
  retries = 2,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const attempt = (tryNum: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      fetch(url, { signal: controller.signal })
        .then((res) => {
          clearTimeout(timer);
          if (res.status === 429 && tryNum < retries) {
            setTimeout(() => attempt(tryNum + 1), 1000 * (tryNum + 1));
            return;
          }
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          if (tryNum < retries) {
            setTimeout(() => attempt(tryNum + 1), 500 * (tryNum + 1));
            return;
          }
          reject(err);
        });
    };
    attempt(0);
  });
}
