import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, log } from "@/lib/server-config";

export const dynamic = "force-dynamic";

// Launch the MT5 terminal application (terminal64.exe).
//
// In production: the MT5 Python bridge (on the user's Windows machine) runs:
//   import subprocess
//   subprocess.Popen([terminal_path])
//   # then poll MetaTrader5.initialize(terminal_path) until it returns True
//   # and store the OS pid in Account.mt5TerminalPid
//
// In this sandbox we simulate the launch: mark terminal as running after a
// short delay and assign a pseudo-pid, so the dashboard UX is demonstrable.

export async function POST() {
  const acc = await ensureAccount();

  if (!acc.mt5TerminalPath) {
    return NextResponse.json(
      {
        error:
          "Path terminal MT5 belum dikonfigurasi. Isi path ke terminal64.exe di Settings → Broker / MT5.",
      },
      { status: 400 },
    );
  }

  if (acc.mt5TerminalRunning) {
    return NextResponse.json({
      ok: true,
      alreadyRunning: true,
      message: "Terminal MT5 sudah berjalan",
      pid: acc.mt5TerminalPid,
    });
  }

  // Simulate launch latency (the real bridge waits for the terminal GUI to init)
  await new Promise((r) => setTimeout(r, 600));

  const pid = Math.floor(2000 + Math.random() * 8000);
  const updated = await db.account.update({
    where: { id: acc.id },
    data: {
      mt5TerminalRunning: true,
      mt5TerminalPid: pid,
    },
  });

  await log(
    "INFO",
    "MT5",
    `MT5 terminal launched: ${updated.mt5TerminalPath} (PID ${pid})`,
  );

  return NextResponse.json({
    ok: true,
    alreadyRunning: false,
    pid,
    path: updated.mt5TerminalPath,
    message: `Terminal MT5 dijalankan (PID ${pid})`,
  });
}
