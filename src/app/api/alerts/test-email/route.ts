import { NextResponse } from "next/server";
import { sendTestEmail } from "@/lib/email";
import { log } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// C2: Real test email endpoint (was toast stub in UI)
export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email tidak valid" }, { status: 400 });
  }

  await log("INFO", "EMAIL", `Test email requested for ${email}`);
  const result = await sendTestEmail(email);

  if (result.sent) {
    return NextResponse.json({ ok: true, sent: true });
  }
  // In sandbox mode, email is logged but not sent — return 200 with reason
  return NextResponse.json({
    ok: true,
    sent: false,
    reason: result.reason ?? "SMTP not configured",
  });
}
