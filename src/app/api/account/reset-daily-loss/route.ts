import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, log } from "@/lib/server-config";
import type { AccountState } from "@/lib/types";

export const dynamic = "force-dynamic";

// L6: Reset Anti-MC counter (dailyLossUsed → 0)
// Used when user wants to manually override the daily loss lockout
export async function POST() {
  const acc = await ensureAccount();
  const updated = await db.account.update({
    where: { id: acc.id },
    data: { dailyLossUsed: 0, lastDailyResetAt: new Date() },
  });
  await log("INFO", "RISK", `Anti-MC counter manually reset to 0% (was ${acc.dailyLossUsed.toFixed(2)}%)`);

  const account: AccountState = {
    broker: updated.broker,
    login: updated.login,
    server: updated.server,
    leverage: updated.leverage,
    currency: updated.currency,
    balance: updated.balance,
    equity: updated.equity,
    margin: updated.margin,
    freeMargin: updated.freeMargin,
    marginLevel: updated.marginLevel,
    mt5Connected: updated.mt5Connected,
    dailyLossUsed: updated.dailyLossUsed,
    dailyLossLimit: updated.dailyLossLimit,
  };
  return NextResponse.json({ account, ok: true });
}
