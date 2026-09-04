# Python MT5 Bridge (Production)

A real MetaTrader 5 bridge for FRxAI, implemented with the official
[`MetaTrader5`](https://pypi.org/project/MetaTrader5/) pip package. It speaks
the **exact same HTTP contract** as the TypeScript dev simulator in
`../mini-services/mt5-bridge/`, so the Next.js app needs **zero changes** to
swap one for the other.

```
Next.js app (:3000)  ──HTTP──▶  python-bridge/mt5_bridge.py (:3001)  ──IPC──▶  MetaTrader 5 terminal  ──▶  FINEX broker
```

> **This bridge is the PRODUCTION path.** It is NOT runnable in the dev
> sandbox (Linux, no MT5 terminal) — syntax is verified with
> `python -m py_compile`, but running it requires Windows. The TypeScript
> simulator (`mini-services/mt5-bridge/`) remains the dev/demo path.

## 1. Prerequisites

- **Windows only** — the `MetaTrader5` pip package requires a running
  MetaTrader 5 terminal on the same machine.
- **MetaTrader 5 terminal** installed, logged into your FINEX demo/live
  account, with **"Algo Trading" enabled** (button in the terminal toolbar
  must be green) and API/IPC access allowed in
  *Tools → Options → Expert Advisors*.
- **Python 3.10 – 3.13** (64-bit, matching your terminal architecture).
- Run the bridge under a **dedicated trading account login** — `/close-all`
  closes every open position on the account (mirroring the simulator's
  "close everything" semantics).

## 2. Install

```powershell
cd python-bridge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 3. Configure

All configuration is via environment variables (none are strictly required —
the app logs in through `POST /connect`):

| Variable | Default | Description |
|---|---|---|
| `MT5_LOGIN` | *(unset)* | Auto-connect at startup when set together with password + server |
| `MT5_PASSWORD` | *(unset)* | Auto-connect credential |
| `MT5_SERVER` | *(unset)* | Broker server name (e.g. `FINEX-Demo`) |
| `MT5_TERMINAL_PATH` | auto-detect | Path to `terminal64.exe` |
| `BRIDGE_PORT` | `3001` | HTTP listen port (keep `3001` for a zero-change swap) |
| `BRIDGE_SYMBOLS` | `BBCA,TLKM,ASII` | Comma-separated MT5 symbol names served by the bridge |
| `BRIDGE_DEVIATION` | `20` | Max slippage (points) for market orders |
| `BRIDGE_MAGIC` | `123456` | Magic number stamped on bridge orders |
| `BRIDGE_HISTORY_DAYS` | `30` | Lookback window for `GET /history` |
| `BRIDGE_MAX_HISTORY` | `100` | Max trades returned by `GET /history` |
| `BRIDGE_COMMISSION_PER_LOT` | `0` | Informational echo in `/symbol-info` (real commissions arrive on deals) |

## 4. Run

```powershell
python mt5_bridge.py
```

uvicorn serves `0.0.0.0:3001`. Log in from the app's UI (*MT5 Connect* panel)
or via API: `POST http://localhost:3001/connect` with
`{"login": 12345, "password": "...", "server": "FINEX-Demo"}`.

> Single worker only (`uvicorn.run` without `workers=`): the MetaTrader5 IPC
> must not be multiplied across processes.

## 5. Swapping the dev simulator for this bridge

1. Stop the simulator: kill the `bun --hot index.ts` process (and the
   supervisor watchdog `bun supervisor.ts` in `mini-services/mt5-bridge/`,
   otherwise it will respawn the simulator).
2. Start this bridge on the same port: `BRIDGE_PORT=3001 python mt5_bridge.py`.
3. Done. The app (`MT5_BRIDGE_URL`, default `http://localhost:3001`) requires
   **no changes** — routes, request bodies, response envelopes, status codes,
   and the heartbeat 401-when-not-connected behavior are identical.
   `/api/health?type=readiness` keeps reporting
   `mt5Bridge: {ok: true, ... "bridge reachable (HTTP 401: session not connected)"}`
   before login, and `200` after.

### Shared HTTP contract (12 endpoints)

| Endpoint | Description |
|---|---|
| `POST /connect` | Login `{login, password, server}` → account info |
| `GET /heartbeat` | 200 + account summary when connected; **401 when not connected (by design)** |
| `POST /disconnect` | Log out + `mt5.shutdown()` |
| `POST /order` | Market buy/sell `{symbol, direction, lotSize, sl?, tp?, comment?}` → `data.ticket`, `data.openPrice`, `data.lotSize` |
| `POST /close` | Close position `{ticket}` |
| `POST /close-all` | Close every open position |
| `POST /modify` | Update SL/TP `{ticket, sl?, tp?}` (absent → keep, `null` → clear, number → set) |
| `GET /positions` | Open positions list |
| `GET /account` | Account info |
| `GET /prices` | Bid/ask per configured symbol |
| `GET /symbol-info/:symbol` | Symbol spec (lot size, tick size, volume limits, …) |
| `GET /history` | Closed trades from deal history |

Success envelope: `{"success": true, "data": {...}}`.
Error envelope: `{"success": false, "code": <httpStatus>, "message": "...",
"mt5Code": <retcode>?, "mt5Description": "..."?}` (plus `error` /
`mt5ErrorDesc` aliases). MT5 retcodes 10004–10036 are mapped to the same
descriptions as the simulator.

## 6. Implementation notes & known differences

- **Thread-safety**: every `mt5.*` call is serialized behind one
  `threading.Lock`; handlers run in Starlette's threadpool.
- **Symbol universe** comes from `BRIDGE_SYMBOLS` — the simulator's fake
  price map is NOT hardcoded.
- Real values replace simulated ones: `openPrice` is the executed deal price
  (fallback: order result price), `commission`/`swap`/`profit` come from the
  deals, `latencyMs` is the measured round trip.
- `/positions[].commission` is `0.0` while open (MT5 charges commissions on
  deals) and `/positions[].sector` is `"UNKNOWN"` (MT5 has no sector field).
- `/history[]` `sl`/`tp` are `null` and `slippage` is `0.0` — MT5 deal
  history does not carry those fields.
- `/order` performs the same SL/TP side-of-market sanity checks as the
  simulator, using the broker's `trade_stops_level` (fallback: 10 points).
  The requested `price` field is tolerated but ignored — fills use the live
  tick ± `BRIDGE_DEVIATION`, exactly like a real market order.
- `/close-all` skips (and logs) individual positions the broker refuses to
  close (frozen/locked), instead of failing the whole sweep.
