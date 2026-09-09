import { NextResponse } from "next/server";
import { aiChat } from "@/lib/ai";
import { log } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  // P3-11: audit log every chat request (message truncated for storage)
  await log("INFO", "AI-CHAT", `Chat request: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`);
  const reply = await aiChat(message);
  return NextResponse.json({ reply });
}
