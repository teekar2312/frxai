import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, log } from "@/lib/server-config";

export const dynamic = "force-dynamic";

// Stop the MT5 terminal application.
//
// In production: the MT5 Python bridge runs:
//   MetaTrader5.shutdown()        # graceful MT5 library shutdown
//   # and optionally taskkill /PID <pid> /F  on Windows to close the GUI
//
// In this sandbox we simulate by clearing the running flag + pid.

export async function POST() {
  const acc = await ensureAccount();

  if (!acc.mt5TerminalRunning) {
    return NextResponse.json({
      ok: true,
      alreadyStopped: true,
      message: "Terminal MT5 tidak sedang berjalan",
    });
  }

  const pid = acc.mt5TerminalPid;
  await db.account.update({
    where: { id: acc.id },
    data: {
      mt5TerminalRunning: false,
      mt5TerminalPid: null,
      // also disconnect the bridge since terminal is gone
      mt5Connected: false,
      margin: 0,
    },
  });

  await log(
    "INFO",
    "MT5",
    `MT5 terminal stopped (PID ${pid ?? "—"})`,
  );

  return NextResponse.json({
    ok: true,
    alreadyStopped: false,
    message: "Terminal MT5 dihentikan",
  });
}
