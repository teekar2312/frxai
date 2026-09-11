import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/server-config";
import type { ApiKeys } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT: ApiKeys = {
  groq: "",
  openai: "",
  together: "",
  tinyfish: "",
  finnhub: "",
  marketaux: "",
  activeProvider: "zai",
  customModel: "",
};

export async function GET() {
  const config = await getConfig<ApiKeys>("apiKeys", DEFAULT);
  const masked = {
    ...config,
    groq: mask(config.groq),
    openai: mask(config.openai),
    together: mask(config.together),
    tinyfish: mask(config.tinyfish),
    finnhub: mask(config.finnhub),
    marketaux: mask(config.marketaux),
  };
  return NextResponse.json({ keys: masked });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<ApiKeys>;
  const current = await getConfig<ApiKeys>("apiKeys", DEFAULT);
  const merged: ApiKeys = { ...current };
  for (const k of Object.keys(body) as (keyof ApiKeys)[]) {
    const v = body[k];
    if (typeof v === "string") {
      if (v && !v.includes("•")) (merged as any)[k] = v;
    } else {
      (merged as any)[k] = v;
    }
  }
  await setConfig("apiKeys", merged);
  return NextResponse.json({ ok: true });
}

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "•".repeat(v.length);
  return v.slice(0, 4) + "•".repeat(Math.max(4, v.length - 8)) + v.slice(-4);
}
