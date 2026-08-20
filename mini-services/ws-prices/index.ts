const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';
const PORT = 3005;

const PAIRS: Record<string, { finnhub: string; pipSize: number; base: number }> = {
  EURUSD: { finnhub: 'OANDA:EUR_USD', pipSize: 0.0001, base: 1.0872 },
  USDJPY: { finnhub: 'OANDA:USD_JPY', pipSize: 0.01, base: 154.32 },
  GBPUSD: { finnhub: 'OANDA:GBP_USD', pipSize: 0.0001, base: 1.2715 },
  XAUUSD: { finnhub: 'OANDA:XAU_USD', pipSize: 0.01, base: 2658.50 },
};

const clients = new Set<import('bun').ServerWebSocket<{ pair: string | null }>>();
const prices: Record<string, { bid: number; ask: number; mid: number; timestamp: number }> = {} as any;
let wsConnected = false;
let finnhubWs: WebSocket | null = null;
let _httpPollInterval: ReturnType<typeof setInterval> | null = null;

function initPrices() {
  for (const [pair, cfg] of Object.entries(PAIRS)) {
    prices[pair] = { bid: cfg.base, ask: cfg.base + cfg.pipSize * 0.5, mid: cfg.base, timestamp: Date.now() };
  }
}
initPrices();

function broadcast(data: Record<string, unknown>) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    try { ws.send(msg); } catch { clients.delete(ws); }
  }
}

function connectFinnhubWs() {
  if (!FINNHUB_API_KEY) return;

  finnhubWs = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);
  finnhubWs.onopen = () => {
    wsConnected = true;
    const symbols = Object.values(PAIRS).map(p => p.finnhub);
    finnhubWs!.send(JSON.stringify({ type: 'subscribe', symbol: symbols }));
  };
  finnhubWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.type === 'trade' && Array.isArray(msg.data)) {
        for (const trade of msg.data) {
          const symbol = trade.s as string;
          const price = trade.p as number;
          const timestamp = trade.t as number;
          for (const [pair, cfg] of Object.entries(PAIRS)) {
            if (cfg.finnhub === symbol) {
              const halfSpread = cfg.pipSize * 0.5;
              const bid = price - halfSpread;
              const ask = price + halfSpread;
              prices[pair] = { bid, ask, mid: price, timestamp };
              broadcast({
                type: 'price',
                pair,
                bid,
                ask,
                mid: price,
                spread: (ask - bid) / cfg.pipSize,
                timestamp,
              });
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }
  };
  finnhubWs.onclose = () => {
    wsConnected = false;
    setTimeout(connectFinnhubWs, 5000);
  };
  finnhubWs.onerror = () => { finnhubWs?.close(); };
}

function startHttpPolling() {
  if (FINNHUB_API_KEY) return; // Only poll when no WS key
  _httpPollInterval = setInterval(() => {
    for (const [pair, cfg] of Object.entries(PAIRS)) {
      const vol = pair === 'XAUUSD' ? 3.5 : (pair === 'USDJPY' ? 0.15 : 0.0003);
      const change = (Math.random() - 0.5) * vol;
      const mid = prices[pair].mid + change;
      const halfSpread = cfg.pipSize * 0.5;
      prices[pair] = { bid: mid - halfSpread, ask: mid + halfSpread, mid, timestamp: Date.now() };
      broadcast({
        type: 'price',
        pair,
        bid: mid - halfSpread,
        ask: mid + halfSpread,
        mid,
        spread: 1,
        timestamp: Date.now(),
      });
    }
  }, 2000);
}

Bun.serve<{ pair: string | null }>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === '/api/status') {
      return new Response(JSON.stringify({
        status: 'ok',
        port: PORT,
        wsConnected,
        clients: clients.size,
        pairs: Object.keys(prices),
        uptime: process.uptime(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Current prices snapshot
    if (url.pathname === '/api/prices') {
      return new Response(JSON.stringify({ prices, simulated: !wsConnected }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade
    if (url.pathname === '/') {
      const pair = url.searchParams.get('pair');
      if (server.upgrade(req, { data: { pair } })) {
        return;
      }
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      // Send current prices on connect
      for (const [pair, data] of Object.entries(prices)) {
        try {
          ws.send(JSON.stringify({ type: 'price', pair, ...data }));
        } catch { /* ignore */ }
      }
    },
    message() { /* client messages ignored */ },
    close(ws) { clients.delete(ws); },
  },
});

if (FINNHUB_API_KEY) {
  connectFinnhubWs();
} else {
  startHttpPolling();
}

console.warn(`[ws-prices] Running on port ${PORT}, mode: ${FINNHUB_API_KEY ? 'Finnhub WS' : 'Simulation Polling'}`);
