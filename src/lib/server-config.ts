import "server-only";
import { db } from "./db";
import { shouldResetDaily } from "./trade-math";

// Generic JSON config store backed by the Configuration table.
export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const row = await db.configuration.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setConfig<T>(key: string, value: T): Promise<void> {
  await db.configuration.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
}

// Ensure a default account row exists.
export async function ensureAccount() {
  let acc = await db.account.findFirst();
  if (!acc) {
    acc = await db.account.create({
      data: {
        broker: "FINEX Indonesia",
        leverage: "1:500",
        balance: 10000,
        equity: 10000,
        freeMargin: 10000,
        dailyLossLimit: 3,
      },
    });
  }
  return acc;
}

/**
 * P0-C2: Reset dailyLossUsed to 0 if the UTC day has changed since last reset.
 * Called before every place/close/tick. Returns the (possibly reset) account.
 */
export async function ensureAccountWithDailyReset() {
  const acc = await ensureAccount();
  if (shouldResetDaily(acc.lastDailyResetAt)) {
    const updated = await db.account.update({
      where: { id: acc.id },
      data: { dailyLossUsed: 0, lastDailyResetAt: new Date() },
    });
    await log("INFO", "RISK", `Daily loss counter reset (was ${acc.dailyLossUsed.toFixed(2)}%)`);
    return updated;
  }
  return acc;
}

export async function log(
  level: "INFO" | "WARN" | "ERROR" | "TRADE" | "AI",
  source: string,
  message: string,
  meta?: unknown,
) {
  try {
    await db.log.create({
      data: {
        level,
        source,
        message,
        meta: meta ? JSON.stringify(meta) : null,
      },
    });
  } catch {
    // ignore logging failures
  }
}
