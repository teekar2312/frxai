// MT5 Bridge - Bridges Next.js app to MT5 Terminal via Expert Advisor (EA)
// Port: 3004
// Supports two EA connection modes:
//   1. WebSocket (ws://localhost:3004/ws) - real-time bidirectional
//   2. HTTP Polling (POST /ea/sync, GET /ea/commands) - for MQL5 WebRequest

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

interface PendingCommand {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: number;
  timeoutAt: number;
  resolve?: (_value: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const MIN_LOT = 0.01;
const MAX_LOT = 50;
const COMMAND_TIMEOUT_MS = 15_000;
const STALE_EA_TIMEOUT_MS = 30_000;
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || '';
if (!BRIDGE_API_KEY) console.warn('[MT5-BRIDGE] BRIDGE_API_KEY not set. Bridge API authentication is DISABLED.');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim());

// ─── State ───────────────────────────────────────────────────────────────────

let mt5Connected = false;
let eaConnectionMethod: "ws" | "http" | null = null;
let mt5Ws: ServerWebSocket | null = null;
let accountInfo: Mt5AccountInfo | null = null;
let positions: Mt5Position[] = [];
const prices: Record<string, { bid: number; ask: number; timestamp: number }> = {};
const pendingRequests: Map<string, { resolve: (_value: unknown) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
let commandQueue: PendingCommand[] = [];
const startTime = Date.now();
let lastPing: number | null = null;
let lastHttpSync: number | null = null;
// Connection tracking
let wsLastMessageTime: number | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCorsHeaders(origin?: string | null): Record<string, string> {
  const allowed = (!origin || ALLOWED_ORIGINS.includes(origin)) ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Bridge-API-Key",
  };
}

function json(data: unknown, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) },
  });
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validateLotSize(lotSize: number): { valid: boolean; error?: string } {
  if (typeof lotSize !== "number" || isNaN(lotSize)) {
    return { valid: false, error: "lotSize must be a valid number" };
  }
  if (lotSize < MIN_LOT) {
    return { valid: false, error: `lotSize must be >= ${MIN_LOT}` };
  }
  if (lotSize > MAX_LOT) {
    return { valid: false, error: `lotSize must be <= ${MAX_LOT}` };
  }
  return { valid: true };
}

// ─── EA Communication (WebSocket) ────────────────────────────────────────────

function sendToEA(message: Record<string, unknown>): boolean {
  if (!mt5Ws || mt5Ws.readyState !== WebSocket.OPEN) return false;
  try {
    mt5Ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function sendAndWait(message: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
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

// ─── EA Communication (HTTP Polling) ─────────────────────────────────────────

function enqueueCommand(type: string, data: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    const id = generateRequestId();
    const timer = setTimeout(() => {
      // Remove from queue if still there
      commandQueue = commandQueue.filter((c) => c.id !== id);
      resolve({ success: false, error: "EA command timed out (no response)" });
    }, COMMAND_TIMEOUT_MS);

    commandQueue.push({
      id,
      type,
      data,
      createdAt: Date.now(),
      timeoutAt: Date.now() + COMMAND_TIMEOUT_MS,
      resolve,
      timer,
    });

    console.log(`[MT5-Bridge] Command queued for HTTP EA: ${type} (id=${id})`);
  });
}

function sendCommandToEA(type: string, data: Record<string, unknown>): Promise<unknown> {
  if (eaConnectionMethod === "http") {
    return enqueueCommand(type, data);
  }
  return sendAndWait({ type, data });
}

// ─── Connection Management ───────────────────────────────────────────────────

function markEaConnected(method: "ws" | "http") {
  if (!mt5Connected) {
    console.log(`[MT5-Bridge] EA connected via ${method.toUpperCase()}`);
  }
  mt5Connected = true;
  eaConnectionMethod = method;
  lastPing = Date.now();
  wsLastMessageTime = Date.now();
}

function markEaDisconnected(reason: string) {
  if (mt5Connected) {
    console.log(`[MT5-Bridge] EA disconnected: ${reason}`);
  }
  mt5Ws = null;
  mt5Connected = false;
  eaConnectionMethod = null;
  lastPing = null;
  lastHttpSync = null;
  wsLastMessageTime = null;

  // Reject all pending requests
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.resolve({ success: false, error: `EA disconnected: ${reason}` });
  }
  pendingRequests.clear();

  // Reject all queued commands
  for (const cmd of commandQueue) {
    if (cmd.timer) clearTimeout(cmd.timer);
    if (cmd.resolve) cmd.resolve({ success: false, error: `EA disconnected: ${reason}` });
  }
  commandQueue = [];

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
      console.log(`[MT5-Bridge] Account updated: #${accountInfo.login} (${accountInfo.name}) balance=${accountInfo.balance}`);
      break;

    case "positions":
      positions = (data as unknown as Mt5Position[]) || [];
      console.log(`[MT5-Bridge] Positions updated: ${positions.length} open`);
      break;

    case "price": {
      const p = data as { pair: string; bid: number; ask: number; timestamp: number };
      const KNOWN_PAIRS = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
      if (p?.pair && KNOWN_PAIRS.includes(p.pair)) {
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
      console.log(`[MT5-Bridge] Order result: ${r.success ? "OK" : "FAIL"} ticket=${r.ticket ?? "N/A"} error=${r.error ?? "none"}`);
      break;
    }

    case "ping":
      lastPing = Date.now();
      wsLastMessageTime = Date.now();
      sendToEA({ type: "pong" });
      break;

    default:
      console.log(`[MT5-Bridge] Unknown EA message type: ${type}`);
  }
}

// ─── HTTP Route Handling ─────────────────────────────────────────────────────

function parseTicket(url: string): string | null {
  const match = url.match(/^\/api\/orders\/(\d+)$/);
  return match ? match[1] : null;
}

// Authentication middleware for API routes (not EA polling routes)
function authenticateRequest(req: Request): boolean {
  const apiKey = req.headers.get('X-Bridge-API-Key');
  return apiKey === BRIDGE_API_KEY;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const origin = req.headers.get('origin');

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
  }

  // Skip auth for EA polling endpoints (they connect from MT5, not Next.js)
  const isEaEndpoint = path.startsWith('/ea/');
  if (!isEaEndpoint && !authenticateRequest(req)) {
    return json({ error: 'Unauthorized: invalid or missing API key' }, 401, origin);
  }

  // ── GET /api/status ──────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/status") {
    return json({
      connected: true,
      eaConnected: mt5Connected,
      eaMethod: eaConnectionMethod,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      lastPing,
      lastHttpSync,
      queuedCommands: commandQueue.length,
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

    // Validate lot size (#13)
    const lotValidation = validateLotSize(body.lotSize);
    if (!lotValidation.valid) {
      return json({ success: false, error: lotValidation.error }, 400);
    }

    console.log(`[MT5-Bridge] Place order: ${body.direction} ${body.pair} x${body.lotSize}`);
    const result = await sendCommandToEA("send_order", body as Record<string, unknown>);
    const cmdResult = result as { success?: boolean; error?: string };
    // H4: Return proper HTTP status codes for order results
    if (!cmdResult.success) {
      const status = cmdResult.error?.includes('timed out') ? 504 : 502;
      return json(cmdResult, status, origin);
    }
    return json(cmdResult, 200, origin);
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
    const result = await sendCommandToEA("close_order", { ticket: Number(ticket) });
    const cmdResult = result as { success?: boolean; error?: string };
    if (!cmdResult.success) {
      const status = cmdResult.error?.includes('timed out') ? 504 : 502;
      return json(cmdResult, status, origin);
    }
    return json(cmdResult, 200, origin);
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
    const result = await sendCommandToEA("modify_order", {
      ticket: Number(ticket),
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
    });
    const cmdResult = result as { success?: boolean; error?: string };
    if (!cmdResult.success) {
      const status = cmdResult.error?.includes('timed out') ? 504 : 502;
      return json(cmdResult, status, origin);
    }
    return json(cmdResult, 200, origin);
  }

  // ── EA HTTP Polling Endpoints ──────────────────────────────────────────

  // POST /ea/sync - EA pushes account info + positions + prices
  if (method === "POST" && path === "/ea/sync") {
    try {
      const body = (await req.json()) as {
        account?: Mt5AccountInfo;
        positions?: Mt5Position[];
      };

      if (body.account) {
        accountInfo = body.account;
        console.log(`[MT5-Bridge] [HTTP] Account synced: #${accountInfo.login} (${accountInfo.name}) balance=${accountInfo.balance}`);
      }
      if (body.positions) {
        positions = body.positions;
        console.log(`[MT5-Bridge] [HTTP] Positions synced: ${positions.length} open`);
      }

      lastHttpSync = Date.now();
      markEaConnected("http");

      return json({ success: true, queuedCommands: commandQueue.length });
    } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }
  }

  // POST /ea/prices - EA pushes price updates
  if (method === "POST" && path === "/ea/prices") {
    try {
      const body = (await req.json()) as {
        prices: { pair: string; bid: number; ask: number; timestamp: number }[];
      };
      if (body.prices && Array.isArray(body.prices)) {
        const KNOWN_PAIRS = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
        for (const p of body.prices) {
          if (p.pair && KNOWN_PAIRS.includes(p.pair)) {
            prices[p.pair] = { bid: p.bid, ask: p.ask, timestamp: p.timestamp || Date.now() };
          }
        }
      }
      lastHttpSync = Date.now();
      return json({ success: true });
    } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }
  }

  // GET /ea/commands - EA polls for pending commands
  if (method === "GET" && path === "/ea/commands") {
    // Clean up expired commands
    const now = Date.now();
    const expired = commandQueue.filter((c) => now > c.timeoutAt);
    for (const cmd of expired) {
      if (cmd.timer) clearTimeout(cmd.timer);
      if (cmd.resolve) cmd.resolve({ success: false, error: "Command expired before EA polled" });
    }
    commandQueue = commandQueue.filter((c) => now <= c.timeoutAt);

    // L6: Atomically swap queue to prevent race condition
    const commands = commandQueue.map((c) => ({
      id: c.id,
      type: c.type,
      data: c.data,
    }));
    commandQueue = [];

    return json({ commands });
  }

  // POST /ea/result - EA sends command execution result
  if (method === "POST" && path === "/ea/result") {
    try {
      const body = (await req.json()) as {
        requestId: string;
        success: boolean;
        ticket?: number;
        error?: string;
        errorCode?: number;
      };

      if (body.requestId && pendingRequests.has(body.requestId)) {
        const pending = pendingRequests.get(body.requestId)!;
        clearTimeout(pending.timer);
        pendingRequests.delete(body.requestId);
        pending.resolve({
          success: body.success,
          ticket: body.ticket,
          error: body.error,
          errorCode: body.errorCode,
        });
      } else {
        // Check command queue for matching resolve
        const cmd = commandQueue.find((c) => c.id === body.requestId);
        if (cmd?.resolve) {
          if (cmd.timer) clearTimeout(cmd.timer);
          cmd.resolve({
            success: body.success,
            ticket: body.ticket,
            error: body.error,
            errorCode: body.errorCode,
          });
          commandQueue = commandQueue.filter((c) => c.id !== body.requestId);
        }
      }

      console.log(`[MT5-Bridge] [HTTP] Order result: ${body.success ? "OK" : "FAIL"} ticket=${body.ticket ?? "N/A"}`);
      return json({ success: true });
    } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  return json({ error: "Not found" }, 404, origin);
}

// ─── Stale EA Detection Timer ───────────────────────────────────────────────

setInterval(() => {
  if (!mt5Connected) return;

  const now = Date.now();
  if (eaConnectionMethod === "http" && lastHttpSync) {
    if (now - lastHttpSync > STALE_EA_TIMEOUT_MS) {
      console.log(`[MT5-Bridge] HTTP EA stale (no sync for ${STALE_EA_TIMEOUT_MS / 1000}s)`);
      markEaDisconnected("HTTP EA stale (no sync received)");
    }
  }
  // C3: WebSocket stale detection
  if (eaConnectionMethod === "ws" && wsLastMessageTime) {
    if (now - wsLastMessageTime > STALE_EA_TIMEOUT_MS) {
      console.log(`[MT5-Bridge] WebSocket EA stale (no message for ${STALE_EA_TIMEOUT_MS / 1000}s)`);
      if (mt5Ws) mt5Ws.close();
      markEaDisconnected("WebSocket EA stale (no message received)");
    }
  }
}, 5000);

// ─── Server ───────────────────────────────────────────────────────────────────

const PORT = 3004;

console.log(`[MT5-Bridge] Starting on port ${PORT}...`);

Bun.serve({
  port: PORT,

  fetch(req, server) {
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
        console.log("[MT5-Bridge] Closing existing WS EA connection (new one connecting)");
        mt5Ws.close();
      }
      mt5Ws = ws;
      markEaConnected("ws");
      console.log("[MT5-Bridge] EA connected via WebSocket");

      // Request initial state sync
      sendToEA({ type: "get_account" });
      sendToEA({ type: "get_positions" });
    },

    message(ws: ServerWebSocket, message: string | Buffer) {
      wsLastMessageTime = Date.now();
      lastPing = Date.now();
      handleEAMessage(message.toString());
    },

    close(ws: ServerWebSocket) {
      if (ws === mt5Ws) {
        markEaDisconnected("WebSocket closed");
      }
    },

    drain(_ws: ServerWebSocket) {
      // Backpressure handled by Bun automatically
    },
  },
});

console.log(`[MT5-Bridge] HTTP + WebSocket server running on http://localhost:${PORT}`);
console.log(`[MT5-Bridge] WebSocket endpoint: ws://localhost:${PORT}/ws`);
console.log(`[MT5-Bridge] EA HTTP polling: POST /ea/sync, GET /ea/commands, POST /ea/result`);
