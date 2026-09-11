import "server-only";
import { db } from "./db";
import { getQuote } from "./market";
import { fetchMarketNews } from "./market-news";
import { sendAlertEmail } from "./email";
import { log } from "./server-config";
import { PAIRS } from "./constants";
import type { Pair } from "./types";

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between re-triggers

/**
 * C1: Check all active PRICE alerts against live quotes.
 * Sets triggered=true + sends email if condition is met.
 * Respects cooldown (lastTriggeredAt).
 */
export async function runPriceAlertCheck(): Promise<{ checked: number; triggered: number; emailsSent: number }> {
  const alerts = await db.alert.findMany({
    where: {
      type: "PRICE",
      active: true,
      triggered: false,
      symbol: { not: null },
      price: { not: null },
      condition: { not: null },
    },
  });

  let triggered = 0;
  let emailsSent = 0;

  for (const alert of alerts) {
    const symbol = alert.symbol as Pair;
    if (!PAIRS.some((p) => p.symbol === symbol)) continue;

    // Check cooldown
    if (alert.lastTriggeredAt && Date.now() - alert.lastTriggeredAt.getTime() < COOLDOWN_MS) {
      continue;
    }

    const quote = getQuote(symbol);
    const condition = alert.condition as "ABOVE" | "BELOW";
    const alertPrice = alert.price!;

    const isTriggered =
      (condition === "ABOVE" && quote.last >= alertPrice) ||
      (condition === "BELOW" && quote.last <= alertPrice);

    if (isTriggered) {
      triggered++;
      await db.alert.update({
        where: { id: alert.id },
        data: {
          triggered: true,
          lastTriggeredAt: new Date(),
          triggerCount: { increment: 1 },
        },
      });

      const msg = `PRICE ALERT: ${symbol} ${condition} ${alertPrice} — current ${quote.last.toFixed(PAIRS.find((p) => p.symbol === symbol)!.digits)}`;
      await log("INFO", "ALERT", msg);

      // Send email if alert has an email address
      if (alert.email) {
        const result = await sendAlertEmail({
          to: alert.email,
          subject: `[FXQuant AI] ${symbol} ${condition} ${alertPrice}`,
          body: `${msg}\n\nWaktu: ${new Date().toISOString()}\nSymbol: ${symbol}\nKondisi: ${condition} ${alertPrice}\nHarga saat ini: ${quote.last}\n\n— FXQuant AI Dashboard`,
        });
        if (result.sent) emailsSent++;
      }
    }
  }

  return { checked: alerts.length, triggered, emailsSent };
}

/**
 * C3: Check NEWS alerts by fetching headlines and matching keywords.
 */
export async function runNewsAlertCheck(): Promise<{ checked: number; matched: number; emailsSent: number }> {
  const alerts = await db.alert.findMany({
    where: {
      type: "NEWS",
      active: true,
      triggered: false,
      symbol: { not: null },
      message: { not: null },
    },
  });

  let matched = 0;
  let emailsSent = 0;

  // Group alerts by symbol to batch news fetches
  const bySymbol: Record<string, typeof alerts> = {};
  for (const a of alerts) {
    const sym = a.symbol!;
    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push(a);
  }

  for (const [symbol, symAlerts] of Object.entries(bySymbol)) {
    if (!PAIRS.some((p) => p.symbol === symbol)) continue;

    // Check cooldown for all alerts of this symbol
    const now = Date.now();
    const offCooldown = symAlerts.filter(
      (a) => !a.lastTriggeredAt || now - a.lastTriggeredAt.getTime() > COOLDOWN_MS,
    );
    if (offCooldown.length === 0) continue;

    // Fetch news for this symbol
    const news = await fetchMarketNews(symbol as Pair);

    for (const alert of offCooldown) {
      const keywords = (alert.message ?? "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0);

      if (keywords.length === 0) continue;

      // Check if any keyword matches any headline
      const matchedNews = news.filter((n) =>
        keywords.some((kw) =>
          n.headline.toLowerCase().includes(kw) ||
          n.summary.toLowerCase().includes(kw),
        ),
      );

      if (matchedNews.length > 0) {
        matched++;
        await db.alert.update({
          where: { id: alert.id },
          data: {
            triggered: true,
            lastTriggeredAt: new Date(),
            triggerCount: { increment: 1 },
          },
        });

        const topNews = matchedNews[0];
        const msg = `NEWS ALERT: ${symbol} keyword "${alert.message}" matched — "${topNews.headline}"`;
        await log("INFO", "ALERT", msg);

        if (alert.email) {
          const result = await sendAlertEmail({
            to: alert.email,
            subject: `[FXQuant AI] News Alert: ${symbol}`,
            body: `${msg}\n\nSource: ${topNews.source}\nHeadline: ${topNews.headline}\nSummary: ${topNews.summary}\n\nWaktu: ${new Date().toISOString()}\n\n— FXQuant AI Dashboard`,
          });
          if (result.sent) emailsSent++;
        }
      }
    }
  }

  return { checked: alerts.length, matched, emailsSent };
}

/**
 * Run both price + news alert checks. Called from /api/auto-trade/tick.
 */
export async function runAlertChecks(): Promise<{ price: Awaited<ReturnType<typeof runPriceAlertCheck>>; news: Awaited<ReturnType<typeof runNewsAlertCheck>> }> {
  const [price, news] = await Promise.all([runPriceAlertCheck(), runNewsAlertCheck()]);
  return { price, news };
}
