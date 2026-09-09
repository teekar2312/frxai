import { NextResponse } from "next/server";
import { ensureAccount } from "@/lib/server-config";

export const dynamic = "force-dynamic";

// Check whether the MT5 terminal application is currently running.
// In production the bridge polls the OS process / MetaTrader5.initialize().

export async function GET() {
  const acc = await ensureAccount();
  return NextResponse.json({
    running: acc.mt5TerminalRunning,
    pid: acc.mt5TerminalPid,
    path: acc.mt5TerminalPath,
    autoStart: acc.mt5AutoStartTerminal,
  });
}
