import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount } from "@/lib/server-config";

export const dynamic = "force-dynamic";

// Mask a secret string, keeping first/last char for display confirmation
function maskSecret(v: string | null): string {
  if (!v) return "";
  if (v.length <= 4) return "•".repeat(v.length);
  return v.slice(0, 1) + "•".repeat(Math.max(4, v.length - 2)) + v.slice(-1);
}

export async function GET() {
  const acc = await ensureAccount();
  return NextResponse.json({
    credentials: {
      mt5Account: acc.mt5Account ?? "",
      mt5Password: maskSecret(acc.mt5Password),
      mt5Server: acc.mt5Server ?? "",
      mt5AccountType: acc.mt5AccountType,
      mt5Terminal: acc.mt5Terminal,
      hasPassword: !!acc.mt5Password,
    },
  });
}

export async function PUT(req: Request) {
  const acc = await ensureAccount();
  const body = (await req.json()) as {
    mt5Account?: string;
    mt5Password?: string;
    mt5Server?: string;
    mt5AccountType?: "demo" | "real";
    mt5Terminal?: string;
  };

  const data: any = {};
  if (body.mt5Account !== undefined) {
    if (!/^\d{4,12}$/.test(body.mt5Account)) {
      return NextResponse.json(
        { error: "Nomor akun MT5 harus 4-12 digit angka" },
        { status: 400 },
      );
    }
    data.mt5Account = body.mt5Account;
    data.login = body.mt5Account;
  }
  // Only overwrite password if it's a real new value (not masked)
  if (body.mt5Password !== undefined && !body.mt5Password.includes("•")) {
    if (body.mt5Password.length < 4) {
      return NextResponse.json(
        { error: "Password MT5 minimal 4 karakter" },
        { status: 400 },
      );
    }
    data.mt5Password = body.mt5Password;
  }
  if (body.mt5Server !== undefined) {
    data.mt5Server = body.mt5Server;
    data.server = body.mt5Server;
  }
  if (body.mt5AccountType !== undefined) data.mt5AccountType = body.mt5AccountType;
  if (body.mt5Terminal !== undefined) data.mt5Terminal = body.mt5Terminal;

  await db.account.update({ where: { id: acc.id }, data });
  return NextResponse.json({ ok: true });
}
