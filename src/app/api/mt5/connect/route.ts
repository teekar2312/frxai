import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, log } from "@/lib/server-config";
import type { AccountState } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ConnectBody {
  mt5Account?: string;
  mt5Password?: string;
  mt5Server?: string;
  mt5AccountType?: "demo" | "real";
  mt5Terminal?: string;
}

// MT5 bridge connect.
// Stores the provided credentials on the Account row and marks the bridge
// as connected. In production the local MT5 Python bridge (on the user's
// Windows machine) reads these credentials and calls:
//   MetaTrader5.login(int(mt5Account), mt5Password, mt5Server)
export async function POST(req: Request) {
  const acc = await ensureAccount();
  const body = (await req.json().catch(() => ({}))) as ConnectBody;

  // Validate required fields when provided
  if (body.mt5Account !== undefined) {
    if (!/^\d{4,12}$/.test(body.mt5Account)) {
      return NextResponse.json(
        { error: "Nomor akun MT5 harus 4-12 digit angka" },
        { status: 400 },
      );
    }
  }
  if (body.mt5Password !== undefined && body.mt5Password.length < 4) {
    return NextResponse.json(
      { error: "Password MT5 minimal 4 karakter" },
      { status: 400 },
    );
  }
  if (body.mt5Server !== undefined && body.mt5Server.trim().length === 0) {
    return NextResponse.json(
      { error: "Server MT5 wajib diisi" },
      { status: 400 },
    );
  }

  // Read existing credentials (so a "connect only" call works if creds saved)
  const existing = acc;
  const account = body.mt5Account ?? existing.mt5Account;
  const password = body.mt5Password ?? existing.mt5Password;
  const server = body.mt5Server ?? existing.mt5Server ?? "FINEX-Live01";

  if (!account || !password) {
    return NextResponse.json(
      {
        error:
          "Nomor akun MT5 dan password wajib diisi. Masukkan kredensial terlebih dahulu.",
      },
      { status: 400 },
    );
  }

  const accountType = body.mt5AccountType ?? existing.mt5AccountType ?? "demo";
  const terminal = body.mt5Terminal ?? existing.mt5Terminal ?? "MetaTrader5";

  const updated = await db.account.update({
    where: { id: acc.id },
    data: {
      mt5Account: account,
      mt5Password: password,
      mt5Server: server,
      mt5AccountType: accountType,
      mt5Terminal: terminal,
      // mirror to legacy login/server fields for display
      login: account,
      server,
      mt5Connected: true,
    },
  });

  await log(
    "INFO",
    "MT5",
    `MT5 bridge connected: akun ${account} @ ${server} (${accountType})`,
  );

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
