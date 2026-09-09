import { NextResponse } from "next/server";
import { ensureAccount } from "@/lib/server-config";
import type { AccountState } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const acc = await ensureAccount();
  const account: AccountState = {
    broker: acc.broker,
    login: acc.login,
    server: acc.server,
    leverage: acc.leverage,
    currency: acc.currency,
    balance: acc.balance,
    equity: acc.equity,
    margin: acc.margin,
    freeMargin: acc.freeMargin,
    marginLevel: acc.marginLevel,
    mt5Connected: acc.mt5Connected,
    dailyLossUsed: acc.dailyLossUsed,
    dailyLossLimit: acc.dailyLossLimit,
  };
  return NextResponse.json({ account });
}
