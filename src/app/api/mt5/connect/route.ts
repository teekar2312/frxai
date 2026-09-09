import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, log } from "@/lib/server-config";
import type { AccountState } from "@/lib/types";

export const dynamic = "force-dynamic";

// Simulated MT5 bridge connect.
// In production this connects to the local MT5 Python bridge on the
// user's Windows machine (FINEX Indonesia server) via the gateway.
export async function POST() {
  const acc = await ensureAccount();
  const login = `90${Math.floor(100000 + Math.random() * 899999)}`;
  const server = "FINEX-Live01";
  const updated = await db.account.update({
    where: { id: acc.id },
    data: { mt5Connected: true, login, server },
  });
  await log("INFO", "MT5", `MT5 bridge connected: login ${login} @ ${server}`);

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
