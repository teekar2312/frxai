import "server-only";
import ZAI from "z-ai-web-dev-sdk";
import { FACTOR_LIST } from "./constants";
import type { AiAnalysisResult, FactorScore, Pair, SignalDirection } from "./types";

// Multi-factor AI market analysis engine.
// Uses z-ai-web-dev-sdk LLM (server-only) to analyze:
//  - Central bank policy relevant to the pair
//  - Key economic data (NFP, CPI, PPI, GDP, Unemployment, Retail Sales, PMI)
//  - Politics & geopolitics
//  - Fiscal & economic policy
//  - Commodity prices
//  - Market sentiment
//  - Breaking news
// Returns a structured JSON analysis the dashboard renders as a factor heatmap + signal.

const SYSTEM_PROMPT = `Anda adalah seorang analis forex kuantitatif senior dan ahli scalping untuk broker FINEX Indonesia (leverage 1:500, spread dari 0.5 pip, komisi $1/lot).
Anda mempunyai pengetahuan mendalam tentang kebijakan bank sentral, data ekonomi makro, geopolitik, kebijakan fiskal, harga komoditas, sentimen pasar, dan berita dadakan.

Tugas: analisa PAIR forex/logam yang diberikan secara multi-faktor dan hasilkan sinyal trading scalping yang REALISTIS.

Aturan money management yang harus dihormati:
- Risk per trade 0.5%–1%
- Stop loss 5–15 pip
- Risk:Reward = 1:1.5
- Hindari news berdampak tinggi saat scalping

Anda WAJIB membalas dengan JSON SAJA (tanpa markdown, tanpa teks tambahan) dengan skema berikut:
{
  "signal": "BUY" | "SELL" | "NEUTRAL",
  "confidence": number (0-100),
  "summary": "ringkasan singkat 2-3 kalimat dalam Bahasa Indonesia",
  "factors": [
    { "factor": "<nama faktor>", "direction": "BUY"|"SELL"|"NEUTRAL", "score": number (-100..100), "detail": "<penjelasan singkat>" }
  ],
  "suggestedEntry": number,
  "suggestedStopLoss": number,
  "suggestedTakeProfit": number
}

Faktor yang HARUS dianalisa (gunakan persis nama-nama ini):
${FACTOR_LIST.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Berikan 7 entri factors (satu per faktor). Skor negatif = bearish, positif = bullish. entry/SL/TP harus konsisten dengan R:R 1:1.5 dan SL 5-15 pip (untuk XAUUSD gunakan $1.5-$4.5).`;

function pairContext(symbol: Pair): string {
  switch (symbol) {
    case "EURUSD":
      return "EURUSD — dipengaruhi ECB (Bank Sentral Eropa) & Federal Reserve (AS). Sensitif terhadap data tenaga kerja AS (NFP), inflasi CPI/PPI, dan kebijakan suku bunga DCT ECB vs Fed Funds Rate. Komoditas: minyak (Eurozone energy), emas sebagai safe haven.";
    case "USDJPY":
      return "USDJPY — dipengaruhi Bank of Japan (BoJ) & Federal Reserve. Sensitif terhadap yield JGB vs Treasury 10Y, intervensi MoF Jepang, dan diferensial suku bunga. Yen adalah safe-haven; melemah saat risk-on.";
    case "GBPUSD":
      return "GBPUSD — dipengaruhi Bank of England (BoE) & Federal Reserve. Sensitif terhadap data UK (CPI, GDP, PMI), Brexit-legacy politik, dan fiskal UK (gilts). Pound volatil saat risiko geopolitik Eropa.";
    case "XAUUSD":
      return "XAUUSD — Emas vs USD. Dipengaruhi suku bunga real Treasury, DXY, sentimen safe-haven, permintaan bank sentral (CB buying), inflasi, dan geopolitik. Invers terhadap yield real & USD. Volatilitas tinggi — SL lebih lebar.";
  }
}

function fallbackAnalysis(symbol: Pair, reason: string): AiAnalysisResult {
  const factors: FactorScore[] = FACTOR_LIST.map((f) => ({
    factor: f,
    direction: "NEUTRAL",
    score: 0,
    detail: `Tidak tersedia (${reason}). Menunggu data.`,
  }));
  return {
    symbol,
    signal: "NEUTRAL",
    confidence: 0,
    summary: `Analisa AI tidak tersedia saat ini: ${reason}. Sinyal dinetralkan untuk keselamatan — tidak disarankan entry.`,
    factors,
  };
}

export async function analyzeMarket(symbol: Pair): Promise<AiAnalysisResult> {
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Lakukan analisa multi-faktor komprehensif untuk PAIR ${symbol} dengan konteks:\n${pairContext(symbol)}\n\nFokus strategi SCALPING (timeframe M1-M5). Berikan output JSON sesuai skema.`,
        },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const jsonStr = extractJson(raw);
    if (!jsonStr) {
      return fallbackAnalysis(symbol, "respons AI tidak terparse");
    }
    const parsed = JSON.parse(jsonStr) as Partial<AiAnalysisResult>;
    const factors = Array.isArray(parsed.factors) && parsed.factors.length > 0
      ? (parsed.factors as FactorScore[]).slice(0, 7)
      : FACTOR_LIST.map((f) => ({ factor: f, direction: "NEUTRAL" as SignalDirection, score: 0, detail: "—" }));
    return {
      symbol,
      signal: (parsed.signal as SignalDirection) ?? "NEUTRAL",
      confidence: clampNum(parsed.confidence, 0, 100, 0),
      summary: parsed.summary ?? "Analisa selesai.",
      factors,
      suggestedEntry: num(parsed.suggestedEntry),
      suggestedStopLoss: num(parsed.suggestedStopLoss),
      suggestedTakeProfit: num(parsed.suggestedTakeProfit),
    };
  } catch (e: any) {
    return fallbackAnalysis(symbol, e?.message ?? "kesalahan SDK");
  }
}

export async function aiChat(userMessage: string): Promise<string> {
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content:
            "Anda adalah asisten trading forex scalping untuk FINEX Indonesia. Jawab ringkas, praktis, dalam Bahasa Indonesia.",
        },
        { role: "user", content: userMessage },
      ],
      thinking: { type: "disabled" },
    });
    return completion.choices[0]?.message?.content ?? "";
  } catch (e: any) {
    return `Maaf, asisten AI tidak tersedia: ${e?.message ?? "error"}`;
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  // strip code fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : undefined;
}
