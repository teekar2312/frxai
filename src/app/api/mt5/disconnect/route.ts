import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, log } from "@/lib/server-config";
import type { AccountState } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST() {
  const acc = await ensureAccount();
  const updated = await db.account.update({
    where: { id: acc.id },
    data: {
      mt5Connected: false,
      // keep credentials saved for quick reconnect; clear margin/equity snapshot
      margin: 0,
    },
  });
  await log("INFO", "MT5", `MT5 bridge disconnected (akun ${updated.mt5Account ?? "—"})`);

  const state: AccountState = {
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
  return NextResponse.json({ account: state, ok: true });
}
