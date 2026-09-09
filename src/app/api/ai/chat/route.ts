import { NextResponse } from "next/server";
import { aiChat } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { message } = (await req.json()) as { message: string };
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  const reply = await aiChat(message);
  return NextResponse.json({ reply });
}
