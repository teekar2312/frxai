import { NextResponse } from "next/server";
import { getAllQuotes } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ quotes: getAllQuotes(), ts: Date.now() });
}
