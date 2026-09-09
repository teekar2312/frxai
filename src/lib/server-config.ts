import "server-only";
import { db } from "./db";

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
