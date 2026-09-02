/**
 * MT5 Bridge — FINEX Indonesia Simulator
 * ========================================
 * A Bun HTTP server (port 3001) that simulates MT5 broker operations for
 * development and demo purposes. Architecture mirrors a real Python MT5
 * bridge so it can be swapped out later with zero frontend changes.
 *
 * Endpoints:
 *   POST /connect        — Login & get account info
 *   GET  /heartbeat      — Connection health + account summary
 *   POST /disconnect     — Clean up session
 *   POST /order          — Market buy/sell
 *   POST /close          — Close position by ticket
 *   POST /close-all      — Close every open position
 *   GET  /positions      — List open positions
 *   GET  /account        — Full account info
 *   GET  /prices         — All symbol bid/ask
 *   GET  /symbol-info/:s — Single symbol spec
 *   GET  /history        — Recent closed trades
 */

// ============================================================
// TYPES
// ============================================================

interface SymbolInfo {
  idxSymbol: string;
  mt5Symbol: string;
  sector: string;
  description: string;
  lotSize: number;
  tickSize: number;
  basePrice: number;
  bid: number;
  ask: number;
}

interface Position {
  ticket: number;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: number;
  openPrice: number;
  openTime: string;
  sl: number | null;
  tp: number | null;
  comment: string;
  commission: number;
}

interface ClosedTrade extends Position {
  closePrice: number;
  closeTime: string;
  profit: number;
  swap: number;
  slippage: number;
}

interface AccountInfo {
  login: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  currency: string;
  profit: number;
  server: string;
  name: string;
}

interface Session {
  connected: boolean;
  login: number;
  password: string;
  server: string;
  name: string;
  connectTime: string;
  latencyMs: number;
}

// ============================================================
// SYMBOL MAP (hardcoded mirror of src/lib/mt5-connection.ts)
// ============================================================

const SYMBOL_MAP: Record<string, Omit<SymbolInfo, "bid" | "ask"> & { basePrice: number }> = {
  BBRI: { idxSymbol: "BBRI", mt5Symbol: "BBRI", sector: "BANKING", description: "Bank Rakyat Indonesia", lotSize: 100, tickSize: 1, basePrice: 5450 },
  BBCA: { idxSymbol: "BBCA", mt5Symbol: "BBCA", sector: "BANKING", description: "Bank Central Asia", lotSize: 100, tickSize: 1, basePrice: 9875 },
  BMRI: { idxSymbol: "BMRI", mt5Symbol: "BMRI", sector: "BANKING", description: "Bank Mandiri", lotSize: 100, tickSize: 1, basePrice: 6250 },
  BBNI: { idxSymbol: "BBNI", mt5Symbol: "BBNI", sector: "BANKING", description: "Bank Negara Indonesia", lotSize: 100, tickSize: 1, basePrice: 4800 },
  TLKM: { idxSymbol: "TLKM", mt5Symbol: "TLKM", sector: "TELECOMMUNICATION", description: "Telkom Indonesia", lotSize: 100, tickSize: 1, basePrice: 3900 },
  ASII: { idxSymbol: "ASII", mt5Symbol: "ASII", sector: "CONGLOMERATE", description: "Astra International", lotSize: 100, tickSize: 1, basePrice: 5200 },
  UNVR: { idxSymbol: "UNVR", mt5Symbol: "UNVR", sector: "CONSUMER_GOODS", description: "Unilever Indonesia", lotSize: 100, tickSize: 1, basePrice: 2850 },
  HMSP: { idxSymbol: "HMSP", mt5Symbol: "HMSP", sector: "CONSUMER_GOODS", description: "HM Sampoerna", lotSize: 100, tickSize: 1, basePrice: 1125 },
  GOTO: { idxSymbol: "GOTO", mt5Symbol: "GOTO", sector: "TECHNOLOGY", description: "GoTo Gojek Tokopedia", lotSize: 100, tickSize: 1, basePrice: 82 },
  BREN: { idxSymbol: "BREN", mt5Symbol: "BREN", sector: "ENERGY", description: "Barito Renewables Energy", lotSize: 100, tickSize: 1, basePrice: 950 },
  ANTM: { idxSymbol: "ANTM", mt5Symbol: "ANTM", sector: "MINING", description: "Aneka Tambang", lotSize: 100, tickSize: 1, basePrice: 1625 },
  ADRO: { idxSymbol: "ADRO", mt5Symbol: "ADRO", sector: "MINING", description: "Adaro Energy", lotSize: 100, tickSize: 1, basePrice: 2980 },
  INCO: { idxSymbol: "INCO", mt5Symbol: "INCO", sector: "MINING", description: "Vale Indonesia", lotSize: 100, tickSize: 1, basePrice: 3750 },
  MEDC: { idxSymbol: "MEDC", mt5Symbol: "MEDC", sector: "ENERGY", description: "Medco Energi Internasional", lotSize: 100, tickSize: 1, basePrice: 1350 },
  BRIS: { idxSymbol: "BRIS", mt5Symbol: "BRIS", sector: "BANKING", description: "Bank Syariah Indonesia", lotSize: 100, tickSize: 1, basePrice: 2650 },
  ERAA: { idxSymbol: "ERAA", mt5Symbol: "ERAA", sector: "CONSUMER_GOODS", description: "Erajaya Swasembada", lotSize: 100, tickSize: 1, basePrice: 478 },
  SRTG: { idxSymbol: "SRTG", mt5Symbol: "SRTG", sector: "INFRASTRUCTURE", description: "Saratoga Investama Sedaya", lotSize: 100, tickSize: 1, basePrice: 2025 },
  BUKA: { idxSymbol: "BUKA", mt5Symbol: "BUKA", sector: "TECHNOLOGY", description: "Bukalapak", lotSize: 100, tickSize: 1, basePrice: 126 },
  ACST: { idxSymbol: "ACST", mt5Symbol: "ACST", sector: "TECHNOLOGY", description: "Adaro Connect", lotSize: 100, tickSize: 1, basePrice: 345 },
  AKRA: { idxSymbol: "AKRA", mt5Symbol: "AKRA", sector: "ENERGY", description: "AKR Corporindo", lotSize: 100, tickSize: 1, basePrice: 1575 },
};

// ============================================================
// MT5 ERROR CODES (mirrors mt5-connection.ts 10004-10036)
// ============================================================

const MT5_ERRORS: Record<number, { description: string; severity: string }> = {
  10004: { description: "Requote", severity: "WARN" },
  10006: { description: "Request rejected", severity: "ERROR" },
  10007: { description: "Request canceled by trader", severity: "INFO" },
  10008: { description: "Order placed", severity: "INFO" },
  10009: { description: "Request executed successfully", severity: "INFO" },
  10011: { description: "Request executed partially", severity: "WARN" },
  10013: { description: "Invalid request", severity: "ERROR" },
  10014: { description: "Invalid volume in request", severity: "ERROR" },
  10015: { description: "Invalid price in request", severity: "ERROR" },
  10016: { description: "Invalid stops in request", severity: "ERROR" },
  10017: { description: "Trade disabled", severity: "CRITICAL" },
  10018: { description: "Market closed", severity: "WARN" },
  10019: { description: "Not enough money for trade", severity: "ERROR" },
  10020: { description: "Prices changed", severity: "WARN" },
  10021: { description: "No quotes to process request", severity: "WARN" },
  10022: { description: "Invalid order expiration date", severity: "ERROR" },
  10023: { description: "Order state changed", severity: "WARN" },
  10024: { description: "Too many requests", severity: "WARN" },
  10025: { description: "No changes in request", severity: "INFO" },
  10026: { description: "Autotrading disabled by server", severity: "CRITICAL" },
  10027: { description: "Autotrading only allowed for live accounts", severity: "ERROR" },
  10028: { description: "Request locked for processing", severity: "WARN" },
  10029: { description: "Order or position frozen", severity: "ERROR" },
  10030: { description: "Invalid order filling type", severity: "ERROR" },
  10031: { description: "No connection to trade server", severity: "CRITICAL" },
  10032: { description: "Operation allowed only for live accounts", severity: "ERROR" },
  10033: { description: "Limit orders only allowed", severity: "WARN" },
  10034: { description: "Volume limit exceeded", severity: "ERROR" },
  10035: { description: "Invalid or incorrect order", severity: "ERROR" },
  10036: { description: "Position already closed", severity: "INFO" },
};

// ============================================================
// SIMULATION CONSTANTS
// ============================================================

const LEVERAGE = 25;
const COMMISSION_PER_LOT = 1.0; // $1/lot
const SPREAD_PIPS = 0.5;
const DEFAULT_BALANCE = 10000;
const TICKET_COUNTER_START = 100000;
const MIN_LOT = 0.01;
const MAX_LOT = 100;
const LOT_STEP = 0.01;
const MIN_SL_TP_DISTANCE_TICKS = 10;

// ============================================================
// SERVER STATE
// ============================================================

let session: Session | null = null;
let balance = DEFAULT_BALANCE;
let positions: Map<number, Position> = new Map();
let history: ClosedTrade[] = [];
let nextTicket = TICKET_COUNTER_START;

// Live price feed with random walk
let livePrices: Record<string, { bid: number; ask: number }> = {};

function initPrices(): void {
  for (const [sym, info] of Object.entries(SYMBOL_MAP)) {
    const spread = info.basePrice * (SPREAD_PIPS / 100) * 2; // ~0.5% total spread
    const halfSpread = spread / 2;
    // Small random offset from base price to simulate being mid-session
    const offset = info.basePrice * (Math.random() * 0.005 - 0.0025);
    const mid = info.basePrice + offset;
    const tick = info.tickSize;
    livePrices[sym] = {
      bid: Math.round((mid - halfSpread) / tick) * tick,
      ask: Math.round((mid + halfSpread) / tick) * tick,
    };
  }
}

/** Apply random walk to all prices (called on every price-dependent request) */
function tickPrices(): void {
  for (const [sym, info] of Object.entries(SYMBOL_MAP)) {
    const current = livePrices[sym];
    const tick = info.tickSize;
    // Daily volatility 0.1-0.5%, scale to per-tick (~1 second intervals)
    // Assuming ~6.5h trading day = 23400 seconds, per-tick vol = daily_vol / sqrt(23400)
    const dailyVol = 0.001 + Math.random() * 0.004; // 0.1%-0.5%
    const perTickVol = dailyVol / Math.sqrt(1000); // approximated
    const meanReversionPull = (info.basePrice - (current.bid + current.ask) / 2) * 0.0001;
    const noise = (Math.random() - 0.5) * 2 * info.basePrice * perTickVol + meanReversionPull;
    const mid = (current.bid + current.ask) / 2 + noise;
    const spread = info.basePrice * (SPREAD_PIPS / 100) * 2;
    const halfSpread = spread / 2;
    livePrices[sym] = {
      bid: Math.max(tick, Math.round((mid - halfSpread) / tick) * tick),
      ask: Math.max(tick, Math.round((mid + halfSpread) / tick) * tick),
    };
  }
}

initPrices();

// ============================================================
// HELPERS
// ============================================================

function logOp(op: string, detail: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] MT5-BRIDGE | ${op} | ${detail}`);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function errorResponse(code: number, message: string, mt5Code?: number): Response {
  const body: Record<string, unknown> = { success: false, code, message };
  if (mt5Code !== undefined) {
    body.mt5Code = mt5Code;
    body.mt5Description = MT5_ERRORS[mt5Code]?.description ?? "Unknown error";
  }
  return jsonResponse(body, code);
}

function requireSession(): Session | Response {
  if (!session || !session.connected) {
    return errorResponse(401, "Not connected. Call POST /connect first.", 10031);
  }
  return session;
}

function simulateLatency(min = 50, max = 150): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}

function calcMargin(symbol: string, lotSize: number): number {
  const info = SYMBOL_MAP[symbol];
  if (!info) return 0;
  const price = livePrices[symbol]?.ask ?? info.basePrice;
  // Margin = (LotSize * lots * price) / Leverage
  // In IDX, lotSize is the contract size (100 shares), price in IDR
  // For USD account: convert IDR to USD (simplified: use 1 USD = 15500 IDR)
  const usdIdrRate = 15500;
  const notionalUsd = (info.lotSize * lotSize * price) / usdIdrRate;
  return notionalUsd / LEVERAGE;
}

function calcProfit(pos: Position): number {
  const prices = livePrices[pos.symbol];
  if (!prices) return 0;
  const currentPrice = pos.direction === "BUY" ? prices.bid : prices.ask;
  const priceDiff = pos.direction === "BUY"
    ? currentPrice - pos.openPrice
    : pos.openPrice - currentPrice;
  const info = SYMBOL_MAP[pos.symbol];
  const usdIdrRate = 15500;
  return (priceDiff * info.lotSize * pos.lotSize) / usdIdrRate;
}

function totalUnrealizedProfit(): number {
  let total = 0;
  for (const pos of positions.values()) {
    total += calcProfit(pos);
  }
  return total;
}

function totalMarginUsed(): number {
  let total = 0;
  for (const pos of positions.values()) {
    total += calcMargin(pos.symbol, pos.lotSize);
  }
  return total;
}

function getSlippage(symbol: string): number {
  const info = SYMBOL_MAP[symbol];
  if (!info) return 0;
  // 0-2 ticks of slippage
  const ticks = Math.floor(Math.random() * 3); // 0, 1, or 2
  return ticks * info.tickSize;
}

function getAccountInfo(): AccountInfo {
  const unrealizedProfit = totalUnrealizedProfit();
  const marginUsed = totalMarginUsed();
  const equity = balance + unrealizedProfit;
  const freeMargin = equity - marginUsed;
  const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : 0;

  return {
    login: session?.login ?? 0,
    balance: Math.round(balance * 100) / 100,
    equity: Math.round(equity * 100) / 100,
    margin: Math.round(marginUsed * 100) / 100,
    freeMargin: Math.round(freeMargin * 100) / 100,
    marginLevel: Math.round(marginLevel * 100) / 100,
    leverage: LEVERAGE,
    currency: "USD",
    profit: Math.round(unrealizedProfit * 100) / 100,
    server: session?.server ?? "",
    name: session?.name ?? "",
  };
}

function validateLotSize(lotSize: number): string | null {
  if (typeof lotSize !== "number" || isNaN(lotSize)) return "lotSize must be a number";
  if (lotSize < MIN_LOT) return `lotSize below minimum (${MIN_LOT})`;
  if (lotSize > MAX_LOT) return `lotSize exceeds maximum (${MAX_LOT})`;
  // Check step alignment
  const steps = Math.round(lotSize / LOT_STEP);
  if (Math.abs(steps * LOT_STEP - lotSize) > 1e-9) {
    return `lotSize must be a multiple of ${LOT_STEP}`;
  }
  return null;
}

function validateSymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  if (!SYMBOL_MAP[upper]) return `Unknown symbol: ${symbol}. Valid: ${Object.keys(SYMBOL_MAP).join(", ")}`;
  return null;
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

async function handleConnect(req: Request): Promise<Response> {
  let body: { login?: number; password?: string; server?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { login, password, server } = body;

  if (typeof login !== "number" || login <= 0) {
    return errorResponse(400, "login must be a positive number");
  }
  if (typeof password !== "string" || password.length < 1) {
    return errorResponse(400, "password is required");
  }
  if (typeof server !== "string" || server.length < 1) {
    return errorResponse(400, "server is required");
  }

  await simulateLatency(50, 150);

  const latency = Math.round(50 + Math.random() * 100);
  session = {
    connected: true,
    login,
    password,
    server,
    name: `FINEX-Demo-${login}`,
    connectTime: new Date().toISOString(),
    latencyMs: latency,
  };

  logOp("CONNECT", `login=${login} server=${server} latency=${latency}ms`);

  return jsonResponse({
    success: true,
    data: {
      connected: true,
      account: getAccountInfo(),
      connectTime: session.connectTime,
      latencyMs: latency,
      server,
    },
  });
}

async function handleHeartbeat(): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  tickPrices();
  const latency = Math.round(5 + Math.random() * 30);
 (session as Session).latencyMs = latency;

  return jsonResponse({
    success: true,
    data: {
      connected: true,
      latencyMs: latency,
      uptimeMs: Date.now() - new Date(s.connectTime).getTime(),
      account: getAccountInfo(),
      openPositions: positions.size,
    },
  });
}

async function handleDisconnect(): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  logOp("DISCONNECT", `login=${s.login} positions=${positions.size}`);
  session = null;
  // Reset state for fresh session
  balance = DEFAULT_BALANCE;
  positions.clear();
  history = [];
  nextTicket = TICKET_COUNTER_START;
  initPrices();

  return jsonResponse({ success: true, data: { disconnected: true } });
}

async function handleOrder(req: Request): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  let body: {
    symbol?: string;
    direction?: string;
    lotSize?: number;
    sl?: number | null;
    tp?: number | null;
    comment?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { symbol, direction, lotSize, sl, tp, comment } = body;

  // Validate symbol
  const symErr = validateSymbol(symbol ?? "");
  if (symErr) return errorResponse(400, symErr, 10013);

  // Validate direction
  const dir = (direction ?? "").toUpperCase();
  if (dir !== "BUY" && dir !== "SELL") {
    return errorResponse(400, "direction must be BUY or SELL", 10013);
  }

  // Validate lot size
  const lotErr = validateLotSize(lotSize ?? 0);
  if (lotErr) return errorResponse(400, lotErr, 10014);

  const sym = (symbol as string).toUpperCase();
  const info = SYMBOL_MAP[sym];
  const prices = livePrices[sym];

  // Validate SL/TP if provided
  if (sl !== null && sl !== undefined) {
    if (typeof sl !== "number" || sl <= 0) {
      return errorResponse(400, "sl must be a positive number", 10016);
    }
    if (dir === "BUY" && sl >= prices.bid - MIN_SL_TP_DISTANCE_TICKS * info.tickSize) {
      return errorResponse(400, "SL for BUY must be below current bid", 10016);
    }
    if (dir === "SELL" && sl <= prices.ask + MIN_SL_TP_DISTANCE_TICKS * info.tickSize) {
      return errorResponse(400, "SL for SELL must be above current ask", 10016);
    }
  }

  if (tp !== null && tp !== undefined) {
    if (typeof tp !== "number" || tp <= 0) {
      return errorResponse(400, "tp must be a positive number", 10016);
    }
    if (dir === "BUY" && tp <= prices.ask + MIN_SL_TP_DISTANCE_TICKS * info.tickSize) {
      return errorResponse(400, "TP for BUY must be above current ask", 10016);
    }
    if (dir === "SELL" && tp >= prices.bid - MIN_SL_TP_DISTANCE_TICKS * info.tickSize) {
      return errorResponse(400, "TP for SELL must be below current bid", 10016);
    }
  }

  // Check margin
  const requiredMargin = calcMargin(sym, lotSize as number);
  const account = getAccountInfo();
  if (requiredMargin > account.freeMargin) {
    return errorResponse(400, "Not enough margin for this trade", 10019);
  }

  await simulateLatency(20, 80);
  tickPrices();

  // Apply slippage
  const slippage = getSlippage(sym);
  const fillPrice = dir === "BUY"
    ? prices.ask + slippage
    : prices.bid - slippage;

  const commission = COMMISSION_PER_LOT * (lotSize as number);
  const ticket = nextTicket++;

  const position: Position = {
    ticket,
    symbol: sym,
    direction: dir as "BUY" | "SELL",
    lotSize: lotSize as number,
    openPrice: Math.round(fillPrice / info.tickSize) * info.tickSize,
    openTime: new Date().toISOString(),
    sl: sl ?? null,
    tp: tp ?? null,
    comment: comment ?? "",
    commission,
  };

  positions.set(ticket, position);

  logOp("ORDER", `ticket=${ticket} ${dir} ${sym} lot=${lotSize} price=${position.openPrice} slippage=${slippage}`);

  return jsonResponse({
    success: true,
    data: {
      ticket,
      symbol: sym,
      direction: dir,
      lotSize: position.lotSize,
      openPrice: position.openPrice,
      slippage,
      commission,
      openTime: position.openTime,
      comment: position.comment,
      retcode: 10009,
      retcodeDescription: MT5_ERRORS[10009].description,
      account: getAccountInfo(),
    },
  });
}

async function handleClose(req: Request): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  let body: { ticket?: number };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { ticket } = body;
  if (typeof ticket !== "number" || ticket <= 0) {
    return errorResponse(400, "ticket must be a positive number", 10035);
  }

  const pos = positions.get(ticket);
  if (!pos) {
    return errorResponse(404, `Position ticket ${ticket} not found`, 10036);
  }

  await simulateLatency(20, 60);
  tickPrices();

  const info = SYMBOL_MAP[pos.symbol];
  const prices = livePrices[pos.symbol];
  const slippage = getSlippage(pos.symbol);
  const closePrice = pos.direction === "BUY"
    ? prices.bid - slippage
    : prices.ask + slippage;
  const roundedClosePrice = Math.round(closePrice / info.tickSize) * info.tickSize;

  const priceDiff = pos.direction === "BUY"
    ? roundedClosePrice - pos.openPrice
    : pos.openPrice - roundedClosePrice;
  const usdIdrRate = 15500;
  const grossProfit = (priceDiff * info.lotSize * pos.lotSize) / usdIdrRate;
  const netProfit = grossProfit - pos.commission;

  // Update balance with realized P&L
  balance += netProfit;

  // Move to history
  const closedTrade: ClosedTrade = {
    ...pos,
    closePrice: roundedClosePrice,
    closeTime: new Date().toISOString(),
    profit: Math.round(netProfit * 100) / 100,
    swap: 0,
    slippage,
  };
  positions.delete(ticket);
  history.unshift(closedTrade);
  // Keep last 100 trades
  if (history.length > 100) history.pop();

  logOp("CLOSE", `ticket=${ticket} ${pos.symbol} closePrice=${roundedClosePrice} profit=${netProfit.toFixed(2)} slippage=${slippage}`);

  return jsonResponse({
    success: true,
    data: {
      ticket,
      symbol: pos.symbol,
      direction: pos.direction,
      lotSize: pos.lotSize,
      openPrice: pos.openPrice,
      closePrice: roundedClosePrice,
      slippage,
      profit: Math.round(netProfit * 100) / 100,
      commission: pos.commission,
      closeTime: closedTrade.closeTime,
      retcode: 10009,
      retcodeDescription: MT5_ERRORS[10009].description,
      account: getAccountInfo(),
    },
  });
}

async function handleCloseAll(): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  if (positions.size === 0) {
    return jsonResponse({
      success: true,
      data: { closed: 0, message: "No open positions" },
    });
  }

  const tickets = Array.from(positions.keys());
  const results: Array<Record<string, unknown>> = [];

  for (const ticket of tickets) {
    const pos = positions.get(ticket)!;
    const info = SYMBOL_MAP[pos.symbol];
    const prices = livePrices[pos.symbol];
    const slippage = getSlippage(pos.symbol);
    const closePrice = pos.direction === "BUY"
      ? prices.bid - slippage
      : prices.ask + slippage;
    const roundedClosePrice = Math.round(closePrice / info.tickSize) * info.tickSize;

    const priceDiff = pos.direction === "BUY"
      ? roundedClosePrice - pos.openPrice
      : pos.openPrice - roundedClosePrice;
    const usdIdrRate = 15500;
    const grossProfit = (priceDiff * info.lotSize * pos.lotSize) / usdIdrRate;
    const netProfit = grossProfit - pos.commission;

    balance += netProfit;

    const closedTrade: ClosedTrade = {
      ...pos,
      closePrice: roundedClosePrice,
      closeTime: new Date().toISOString(),
      profit: Math.round(netProfit * 100) / 100,
      swap: 0,
      slippage,
    };
    positions.delete(ticket);
    history.unshift(closedTrade);
    if (history.length > 100) history.pop();

    results.push({
      ticket,
      symbol: pos.symbol,
      direction: pos.direction,
      lotSize: pos.lotSize,
      openPrice: pos.openPrice,
      closePrice: roundedClosePrice,
      profit: Math.round(netProfit * 100) / 100,
      slippage,
    });
  }

  logOp("CLOSE-ALL", `closed=${tickets.length} tickets=[${tickets.join(",")}]`);

  return jsonResponse({
    success: true,
    data: {
      closed: tickets.length,
      trades: results,
      account: getAccountInfo(),
    },
  });
}

async function handlePositions(): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  tickPrices();

  const result = Array.from(positions.values()).map((pos) => {
    const profit = calcProfit(pos);
    const info = SYMBOL_MAP[pos.symbol];
    const prices = livePrices[pos.symbol];
    return {
      ticket: pos.ticket,
      symbol: pos.symbol,
      sector: info.sector,
      description: info.description,
      direction: pos.direction,
      lotSize: pos.lotSize,
      openPrice: pos.openPrice,
      currentBid: prices.bid,
      currentAsk: prices.ask,
      sl: pos.sl,
      tp: pos.tp,
      profit: Math.round(profit * 100) / 100,
      commission: pos.commission,
      openTime: pos.openTime,
      comment: pos.comment,
    };
  });

  return jsonResponse({
    success: true,
    data: {
      positions: result,
      count: result.length,
      totalProfit: Math.round(totalUnrealizedProfit() * 100) / 100,
    },
  });
}

async function handleAccount(): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  tickPrices();
  const account = getAccountInfo();

  return jsonResponse({
    success: true,
    data: account,
  });
}

async function handlePrices(): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  tickPrices();

  const prices: Record<string, { bid: number; ask: number; spread: number; timestamp: string }> = {};
  for (const [sym, info] of Object.entries(SYMBOL_MAP)) {
    const p = livePrices[sym];
    prices[sym] = {
      bid: p.bid,
      ask: p.ask,
      spread: p.ask - p.bid,
      timestamp: new Date().toISOString(),
    };
  }

  return jsonResponse({
    success: true,
    data: prices,
  });
}

async function handleSymbolInfo(url: URL): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  // Extract symbol from path: /symbol-info/BBRI
  const pathParts = url.pathname.split("/");
  const rawSymbol = pathParts[pathParts.length - 1];
  const sym = rawSymbol.toUpperCase();

  const info = SYMBOL_MAP[sym];
  if (!info) {
    return errorResponse(404, `Symbol not found: ${rawSymbol}. Valid: ${Object.keys(SYMBOL_MAP).join(", ")}`, 10013);
  }

  tickPrices();
  const prices = livePrices[sym];

  return jsonResponse({
    success: true,
    data: {
      symbol: info.mt5Symbol,
      sector: info.sector,
      description: info.description,
      lotSize: info.lotSize,
      tickSize: info.tickSize,
      bid: prices.bid,
      ask: prices.ask,
      spread: prices.ask - prices.bid,
      minLot: MIN_LOT,
      maxLot: MAX_LOT,
      lotStep: LOT_STEP,
      leverage: LEVERAGE,
      commissionPerLot: COMMISSION_PER_LOT,
      currency: "USD",
    },
  });
}

async function handleHistory(): Promise<Response> {
  const s = requireSession();
  if (s instanceof Response) return s;

  return jsonResponse({
    success: true,
    data: {
      trades: history,
      count: history.length,
      totalRealizedProfit: Math.round(history.reduce((sum, t) => sum + t.profit, 0) * 100) / 100,
    },
  });
}

// ============================================================
// ROUTER
// ============================================================

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    // POST /connect
    if (path === "/connect" && method === "POST") {
      return await handleConnect(req);
    }

    // GET /heartbeat
    if (path === "/heartbeat" && method === "GET") {
      return await handleHeartbeat();
    }

    // POST /disconnect
    if (path === "/disconnect" && method === "POST") {
      return await handleDisconnect();
    }

    // POST /order
    if (path === "/order" && method === "POST") {
      return await handleOrder(req);
    }

    // POST /close
    if (path === "/close" && method === "POST") {
      return await handleClose(req);
    }

    // POST /close-all
    if (path === "/close-all" && method === "POST") {
      return await handleCloseAll();
    }

    // GET /positions
    if (path === "/positions" && method === "GET") {
      return await handlePositions();
    }

    // GET /account
    if (path === "/account" && method === "GET") {
      return await handleAccount();
    }

    // GET /prices
    if (path === "/prices" && method === "GET") {
      return await handlePrices();
    }

    // GET /symbol-info/:symbol
    if (path.startsWith("/symbol-info/") && method === "GET") {
      return await handleSymbolInfo(url);
    }

    // GET /history
    if (path === "/history" && method === "GET") {
      return await handleHistory();
    }

    // 404
    return errorResponse(404, `Not found: ${method} ${path}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logOp("ERROR", `path=${path} error="${message}"`);
    return errorResponse(500, `Internal server error: ${message}`);
  }
}

// ============================================================
// SERVER START
// ============================================================

const PORT = 3001;

console.log("=".repeat(60));
console.log("  MT5 Bridge — FINEX Indonesia Simulator");
console.log("  Port: " + PORT);
console.log("  Symbols: " + Object.keys(SYMBOL_MAP).length);
console.log("  Leverage: 1:" + LEVERAGE);
console.log("  Spread: " + SPREAD_PIPS + " pip");
console.log("  Commission: $" + COMMISSION_PER_LOT + "/lot");
console.log("  Default balance: $" + DEFAULT_BALANCE);
console.log("=".repeat(60));

Bun.serve({
  port: PORT,
  fetch: handler,
});

console.log("[" + new Date().toISOString() + "] MT5 Bridge server listening on port " + PORT);
