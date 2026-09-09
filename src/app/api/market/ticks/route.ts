import { NextResponse } from "next/server";
import { publishTicks } from "@/lib/market-cache";
import { log } from "@/lib/server-config";
import type { Quote } from "@/lib/types";

export const dynamic = "force-dynamic";

// Bridge pushes real MT5 ticks here every second.
// Body: { quotes: Quote[] }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { quotes?: Quote[] };
  if (!body.quotes || !Array.isArray(body.quotes)) {
    return NextResponse.json({ error: "quotes array required" }, { status: 400 });
  }
  const count = publishTicks(body.quotes);
  return NextResponse.json({ ok: true, received: count, ts: Date.now() });
}
