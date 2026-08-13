// MT5 Bridge - Bridges Next.js app to MT5 Terminal via Expert Advisor (EA)
// Port: 3004

import type { ServerWebSocket } from "bun";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Mt5AccountInfo {
  login: number;
  name: string;
  server: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  currency: string;
  profit: number;
  openPositions: number;
}

interface Mt5Position {
  ticket: number;
  pair: string;
  direction: "BUY" | "SELL";
  lotSize: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number;
  pnlPips: number;
  commission: number;
  swap: number;
  comment: string;
  openTime: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let mt5Connected = false;
let mt5Ws: ServerWebSocket | null = null;
let accountInfo: Mt5AccountInfo | null = null;
let positions: Mt5Position[] = [];
let prices: Record<string, { bid: number; ask: number; timestamp: number }> = {};
let pendingRequests: Map<
  string,
  { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
> = new Map();
let startTime = Date.now();
let lastPing: number | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sendToEA(message: Record<string, unknown>): boolean {
  if (!mt5Ws || mt5Ws.readyState !== WebSocket.OPEN) return false;
  try {
    mt5Ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function sendAndWait(
  message: Record<string, unknown>,
  timeoutMs = 10_000
): Promise<unknown> {
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ success: false, error: "Request timed out" });
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, timer });
    message.requestId = requestId;
    const sent = sendToEA(message);
    if (!sent) {
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      resolve({ success: false, error: "MT5 not connected" });
    }
  });
}

// ─── WebSocket Message Handler ───────────────────────────────────────────────

function handleEAMessage(raw: string) {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.error("[MT5-Bridge] Invalid JSON from EA:", raw);
    return;
  }

  const type = msg.type as string;
  const data = msg.data;

  switch (type) {
    case "account":
      accountInfo = data as unknown as Mt5AccountInfo;
      console.log(
        `[MT5-Bridge] Account updated: #${accountInfo.login} (${accountInfo.name}) balance=${accountInfo.balance}`
      );
      break;

    case "positions":
      positions = (data as unknown as Mt5Position[]) || [];
      console.log(`[MT5-Bridge] Positions updated: ${positions.length} open`);
      break;

    case "price": {
      const p = data as { pair: string; bid: number; ask: number; timestamp: number };
      if (p?.pair) {
        prices[p.pair] = { bid: p.bid, ask: p.ask, timestamp: p.timestamp };
      }
      break;
    }

    case "order_result": {
      const r = data as {
        requestId: string;
        success: boolean;
        ticket?: number;
        error?: string;
        errorCode?: number;
      };
      if (r?.requestId && pendingRequests.has(r.requestId)) {
        const pending = pendingRequests.get(r.requestId)!;
        clearTimeout(pending.timer);
        pendingRequests.delete(r.requestId);
        pending.resolve({
          success: r.success,
          ticket: r.ticket,
          error: r.error,
          errorCode: r.errorCode,
        });
      }
      console.log(
        `[MT5-Bridge] Order result: ${r.success ? "OK" : "FAIL"} ticket=${r.ticket ?? "N/A"} error=${r.error ?? "none"}`
      );
      break;
    }

    case "ping":
      lastPing = Date.now();
      sendToEA({ type: "pong" });
      break;

    default:
      console.log(`[MT5-Bridge] Unknown EA message type: ${type}`);
  }
}

// ─── HTTP Route Handling ─────────────────────────────────────────────────────

function parseTicket(url: string): string | null {
  // URL pattern: /api/orders/:ticket
  const match = url.match(/^\/api\/orders\/(\d+)$/);
  return match ? match[1] : null;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── GET /api/status ──────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/status") {
    return json({
      connected: true,
      eaConnected: mt5Connected,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      lastPing,
    });
  }

  // ── GET /api/account ─────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/account") {
    if (!mt5Connected || !accountInfo) {
      return json({ error: "MT5 not connected" }, 503);
    }
    return json(accountInfo);
  }

  // ── GET /api/positions ───────────────────────────────────────────────────
  if (method === "GET" && path === "/api/positions") {
    return json(positions);
  }

  // ── GET /api/prices ──────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/prices") {
    return json(prices);
  }

  // ── POST /api/orders ─────────────────────────────────────────────────────
  if (method === "POST" && path === "/api/orders") {
    if (!mt5Connected) {
      return json({ success: false, error: "MT5 not connected" }, 503);
    }
    const body = (await req.json()) as {
      pair: string;
      direction: string;
      lotSize: number;
      stopLoss?: number;
      takeProfit?: number;
      comment?: string;
    };
    console.log(`[MT5-Bridge] Place order: ${body.direction} ${body.pair} x${body.lotSize}`);
    const result = await sendAndWait({ type: "send_order", data: body });
    return json(result);
  }

  // ── DELETE /api/orders/:ticket ───────────────────────────────────────────
  if (method === "DELETE" && path.startsWith("/api/orders/")) {
    const ticket = parseTicket(path);
    if (!ticket) {
      return json({ success: false, error: "Invalid ticket" }, 400);
    }
    if (!mt5Connected) {
      return json({ success: false, error: "MT5 not connected" }, 503);
    }
    console.log(`[MT5-Bridge] Close order: #${ticket}`);
    const result = await sendAndWait({
      type: "close_order",
      data: { ticket: Number(ticket) },
    });
    return json(result);
  }

  // ── PATCH /api/orders/:ticket ────────────────────────────────────────────
  if (method === "PATCH" && path.startsWith("/api/orders/")) {
    const ticket = parseTicket(path);
    if (!ticket) {
      return json({ success: false, error: "Invalid ticket" }, 400);
    }
    if (!mt5Connected) {
      return json({ success: false, error: "MT5 not connected" }, 503);
    }
    const body = (await req.json()) as {
      stopLoss?: number;
      takeProfit?: number;
    };
    console.log(`[MT5-Bridge] Modify order: #${ticket} SL=${body.stopLoss} TP=${body.takeProfit}`);
    const result = await sendAndWait({
      type: "modify_order",
      data: { ticket: Number(ticket), stopLoss: body.stopLoss, takeProfit: body.takeProfit },
    });
    return json(result);
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  return json({ error: "Not found" }, 404);
}

// ─── Server ───────────────────────────────────────────────────────────────────

const PORT = 3004;

console.log(`[MT5-Bridge] Starting on port ${PORT}...`);

Bun.serve({
  port: PORT,

  fetch(req, server) {
    // Upgrade to WebSocket for /ws
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) {
        return; // upgrade initiated
      }
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return handleRequest(req);
  },

  websocket: {
    open(ws: ServerWebSocket) {
      if (mt5Ws && mt5Ws.readyState === 1) {
        console.log("[MT5-Bridge] Closing existing EA connection (new one connecting)");
        mt5Ws.close();
      }
      mt5Ws = ws;
      mt5Connected = true;
      console.log("[MT5-Bridge] EA connected via WebSocket");

      // Request initial state sync
      sendToEA({ type: "get_account" });
      sendToEA({ type: "get_positions" });
    },

    message(ws: ServerWebSocket, message: string | Buffer) {
      handleEAMessage(message.toString());
    },

    close(ws: ServerWebSocket) {
      if (ws === mt5Ws) {
        mt5Ws = null;
        mt5Connected = false;
        console.log("[MT5-Bridge] EA disconnected");

        // Reject all pending requests
        for (const [, pending] of pendingRequests) {
          clearTimeout(pending.timer);
          pending.resolve({ success: false, error: "EA disconnected" });
        }
        pendingRequests.clear();
      }
    },

    drain(ws: ServerWebSocket) {
      // Backpressure handled by Bun automatically
    },
  },
});

console.log(`[MT5-Bridge] HTTP + WebSocket server running on http://localhost:${PORT}`);
console.log(`[MT5-Bridge] WebSocket endpoint: ws://localhost:${PORT}/ws`);
