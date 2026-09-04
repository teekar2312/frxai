#!/usr/bin/env python3
"""
MT5 Bridge — FINEX Indonesia (Real MetaTrader 5 implementation)
===============================================================
A FastAPI HTTP server (default port 3001) that talks to a REAL MetaTrader 5
terminal through the official `MetaTrader5` pip package.

This is the PRODUCTION bridge. The TypeScript simulator in
../mini-services/mt5-bridge/index.ts is the DEV/DEMO path. Both speak the
EXACT same HTTP contract, so the Next.js app needs ZERO changes to swap one
for the other (stop the simulator, start this bridge on the same port).

Endpoints (identical routes / request shapes / response envelopes):
    POST /connect          — Login & get account info
    GET  /heartbeat        — Connection health + account summary (401 when not connected — BY DESIGN)
    POST /disconnect       — Clean up session (mt5.shutdown)
    POST /order            — Market buy/sell (TRADE_ACTION_DEAL)
    POST /close            — Close position by ticket (opposite-side DEAL)
    POST /close-all        — Close every open position
    POST /modify           — Update SL/TP of an open position (TRADE_ACTION_SLTP)
    GET  /positions        — List open positions
    GET  /account          — Full account info
    GET  /prices           — All symbol bid/ask (SymbolInfoTick)
    GET  /symbol-info/:sym — Single symbol spec (SymbolInfo)
    GET  /history          — Recent closed trades (HistoryDealsGet)

Response envelopes:
    success → { "success": true,  "data": { ... } }
    error   → { "success": false, "code": <httpStatus>, "message": <str>,
                "mt5Code": <mt5 retcode>?, "mt5Description": <str>? }

    NOTE on error keys: the TS simulator emits { code, message, mt5Code,
    mt5Description }. Some app call sites read `message ?? error` and the
    task sketch mentioned `error` / `mt5ErrorDesc`. To guarantee a zero-change
    swap under EITHER reading, this bridge emits the simulator's keys plus
    harmless aliases: `error` (= message) and `mt5ErrorDesc`
    (= mt5Description). JSON consumers ignore unknown keys, so this superset
    is contract-identical.

Thread-safety: the MetaTrader5 package is NOT safe for concurrent calls.
All mt5.* calls are serialized behind a single threading.Lock. FastAPI
endpoints are thin async wrappers (manual JSON parsing, to mirror the
simulator's "Invalid JSON body" 400) that run the sync core handlers in
Starlette's threadpool via fastapi.concurrency.run_in_threadpool.

Configuration (env vars):
    MT5_LOGIN        optional — auto-connect at startup when set with password+server
    MT5_PASSWORD     optional — auto-connect credential
    MT5_SERVER       optional — auto-connect broker server name
    MT5_TERMINAL_PATH optional — path to terminal64.exe (defaults to auto-detect)
    BRIDGE_PORT      default 3001
    BRIDGE_SYMBOLS   comma-separated MT5 symbol names, default "BBCA,TLKM,ASII"
    BRIDGE_DEVIATION default 20 (max slippage in points for market orders)
    BRIDGE_MAGIC     default 123456 (magic number stamped on bridge orders)
    BRIDGE_HISTORY_DAYS  default 30 (lookback window for GET /history)
    BRIDGE_MAX_HISTORY  default 100 (cap, mirrors simulator's last-100)
    BRIDGE_COMMISSION_PER_LOT default 0.0 (echoed by /symbol-info only — real
                       commissions are broker-side and arrive on deals)

Requires: Windows + a running MetaTrader 5 terminal with "Algo Trading"
enabled (the MetaTrader5 pip package only works on Windows).
Run: python mt5_bridge.py  (uvicorn on 0.0.0.0:3001)
"""

import json
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

# ============================================================
# MetaTrader5 IMPORT (Windows-only package — graceful guard)
# ============================================================

try:
    import MetaTrader5 as mt5

    MT5_AVAILABLE = True
except ImportError:  # pragma: no cover — non-Windows / not installed
    mt5 = None
    MT5_AVAILABLE = False

# ============================================================
# CONFIG (env)
# ============================================================

MT5_LOGIN = os.getenv("MT5_LOGIN", "").strip()
MT5_PASSWORD = os.getenv("MT5_PASSWORD", "").strip()
MT5_SERVER = os.getenv("MT5_SERVER", "").strip()
MT5_TERMINAL_PATH = os.getenv("MT5_TERMINAL_PATH", "").strip() or None

BRIDGE_PORT = int(os.getenv("BRIDGE_PORT", "3001"))
BRIDGE_SYMBOLS = [
    s.strip().upper()
    for s in os.getenv("BRIDGE_SYMBOLS", "BBCA,TLKM,ASII").split(",")
    if s.strip()
]
BRIDGE_DEVIATION = int(os.getenv("BRIDGE_DEVIATION", "20"))
BRIDGE_MAGIC = int(os.getenv("BRIDGE_MAGIC", "123456"))
BRIDGE_HISTORY_DAYS = int(os.getenv("BRIDGE_HISTORY_DAYS", "30"))
BRIDGE_MAX_HISTORY = int(os.getenv("BRIDGE_MAX_HISTORY", "100"))
BRIDGE_COMMISSION_PER_LOT = float(os.getenv("BRIDGE_COMMISSION_PER_LOT", "0"))

# Mirror of the simulator's trading constants (global lot validation).
# The broker's per-symbol volume limits remain the second line of defense.
MIN_LOT = 0.01
MAX_LOT = 100.0
LOT_STEP = 0.01

# Mirror of the simulator's SL/TP sanity distance when the broker does not
# publish one (trade_stops_level == 0): keep stops at least this many points
# away from the market. When the broker publishes a larger stops level, the
# broker value wins.
MIN_STOPS_POINTS = 10

# ============================================================
# MT5 ERROR CODES (mirrors the TS simulator 10004-10036)
# ============================================================

MT5_ERRORS = {
    10004: ("Requote", "WARN"),
    10006: ("Request rejected", "ERROR"),
    10007: ("Request canceled by trader", "INFO"),
    10008: ("Order placed", "INFO"),
    10009: ("Request executed successfully", "INFO"),
    10011: ("Request executed partially", "WARN"),
    10013: ("Invalid request", "ERROR"),
    10014: ("Invalid volume in request", "ERROR"),
    10015: ("Invalid price in request", "ERROR"),
    10016: ("Invalid stops in request", "ERROR"),
    10017: ("Trade disabled", "CRITICAL"),
    10018: ("Market closed", "WARN"),
    10019: ("Not enough money for trade", "ERROR"),
    10020: ("Prices changed", "WARN"),
    10021: ("No quotes to process request", "WARN"),
    10022: ("Invalid order expiration date", "ERROR"),
    10023: ("Order state changed", "WARN"),
    10024: ("Too many requests", "WARN"),
    10025: ("No changes in request", "INFO"),
    10026: ("Autotrading disabled by server", "CRITICAL"),
    10027: ("Autotrading only allowed for live accounts", "ERROR"),
    10028: ("Request locked for processing", "WARN"),
    10029: ("Order or position frozen", "ERROR"),
    10030: ("Invalid order filling type", "ERROR"),
    10031: ("No connection to trade server", "CRITICAL"),
    10032: ("Operation allowed only for live accounts", "ERROR"),
    10033: ("Limit orders only allowed", "WARN"),
    10034: ("Volume limit exceeded", "ERROR"),
    10035: ("Invalid or incorrect order", "ERROR"),
    10036: ("Position already closed", "INFO"),
}

TRADE_RETCODE_DONE = 10009  # mt5.TRADE_RETCODE_DONE


def mt5_error_desc(code: int) -> str:
    entry = MT5_ERRORS.get(int(code))
    return entry[0] if entry else "Unknown error"


# ============================================================
# SESSION STATE + GLOBAL MT5 LOCK
# ============================================================

# Single lock serializing EVERY mt5.* call (the MetaTrader5 package is not
# thread-safe; FastAPI sync cores run in Starlette's threadpool).
MT5_LOCK = threading.Lock()

# Session mirrors the TS simulator's Session semantics: connected only after
# a successful POST /connect; all other endpoints 401 until then.
SESSION = {
    "connected": False,
    "login": 0,
    "server": "",
    "name": "",
    "connect_time": None,  # ISO string
    "connect_ms": 0.0,     # epoch ms (for uptimeMs)
    "latency_ms": 0,
}

# Terminal IPC lifecycle flag (mt5.initialize / mt5.shutdown).
IPC_INITIALIZED = {"ok": False}


# ============================================================
# LOGGING (mirrors simulator's "[ISO] MT5-BRIDGE | OP | detail")
# ============================================================

def utc_iso(dt: datetime) -> str:
    """ISO-8601 with milliseconds + Z suffix — JS `new Date().toISOString()` equivalent."""
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def utc_iso_now() -> str:
    return utc_iso(datetime.now(timezone.utc))


def utc_iso_epoch(seconds: float) -> str:
    """Convert MT5 epoch seconds to the simulator's ISO string format."""
    try:
        return utc_iso(datetime.fromtimestamp(float(seconds), tz=timezone.utc))
    except (ValueError, OverflowError, OSError):
        return utc_iso_now()


def log_op(op: str, detail: str) -> None:
    print(f"[{utc_iso_now()}] MT5-BRIDGE | {op} | {detail}", flush=True)


def r2(x) -> float:
    """Round to 2 decimals, coercing numpy scalars (MetaTrader5 returns them) to Python floats."""
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return 0.0


def f(x) -> float:
    """Coerce a (possibly numpy) number to a plain float."""
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def i(x) -> int:
    """Coerce a (possibly numpy) number to a plain int."""
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


# ============================================================
# ERROR ENVELOPE
# ============================================================

class BridgeError(Exception):
    """Raised by core handlers; converted to the simulator's error envelope."""

    def __init__(self, status_code: int, message: str, mt5_code=None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.mt5_code = mt5_code


def json_response(data, status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status, content=data)


def error_response(status_code: int, message: str, mt5_code=None) -> JSONResponse:
    """Exact mirror of the simulator's errorResponse() body (plus alias keys)."""
    body = {"success": False, "code": status_code, "message": message}
    # Alias keys so consumers reading `error` / `mt5ErrorDesc` (task sketch)
    # and those reading `message` / `mt5Description` (simulator) both work.
    body["error"] = message
    if mt5_code is not None:
        body["mt5Code"] = int(mt5_code)
        body["mt5Description"] = mt5_error_desc(mt5_code)
        body["mt5ErrorDesc"] = body["mt5Description"]
    return json_response(body, status_code)


def internal_error(exc: Exception) -> JSONResponse:
    """Mirror of the simulator's catch-all: 500 + 'Internal server error: ...'."""
    msg = str(exc) or exc.__class__.__name__
    log_op("ERROR", f'error="{msg}"')
    return error_response(500, f"Internal server error: {msg}")


def require_session() -> None:
    """Mirror of the simulator's requireSession(): 401 + mt5Code 10031 when not connected."""
    if not SESSION["connected"]:
        raise BridgeError(401, "Not connected. Call POST /connect first.", 10031)


# ============================================================
# MT5 SESSION HELPERS  (all callers MUST hold MT5_LOCK)
# ============================================================

def _ensure_mt5_package() -> None:
    if not MT5_AVAILABLE:
        raise BridgeError(500, "MetaTrader5 package is not available (Windows-only). "
                               "Install it with: pip install MetaTrader5")


def _mt5_initialize() -> bool:
    """Initialize terminal IPC once (idempotent). Returns True on success."""
    if IPC_INITIALIZED["ok"]:
        return True
    kwargs = {"path": MT5_TERMINAL_PATH} if MT5_TERMINAL_PATH else {}
    ok = bool(mt5.initialize(**kwargs))
    if ok:
        IPC_INITIALIZED["ok"] = True
    else:
        code, desc = mt5.last_error()
        log_op("INIT", f"mt5.initialize() failed code={code} desc={desc}")
    return ok


def _ensure_ready() -> None:
    """All-in-one gate for protected endpoints (caller MUST hold MT5_LOCK).

    Ordering mirrors the simulator's requireSession-first behavior:
      1. no session          → 401 "Not connected. Call POST /connect first." (10031)
      2. package missing     → 500 (misconfiguration — Windows-only package)
      3. terminal link lost  → 401 (same body — session invalidated)
    """
    require_session()
    _ensure_mt5_package()
    terminal = mt5.terminal_info()
    if terminal is None or not bool(getattr(terminal, "connected", False)):
        SESSION["connected"] = False
        log_op("SESSION", "terminal lost connection — session invalidated")
        raise BridgeError(401, "Not connected. Call POST /connect first.", 10031)


def _mt5_login(login: int, password: str, server: str) -> bool:
    """initialize() (lazy) + login(). Returns True on success."""
    _ensure_mt5_package()
    if not _mt5_initialize():
        # mt5.login() can still auto-launch/attach to a running terminal.
        pass
    return bool(mt5.login(login, password=password, server=server))


def _account_info_dict():
    """Map mt5.account_info() → the simulator's AccountInfo shape (2dp rounding)."""
    info = mt5.account_info()
    if info is None:
        code, desc = mt5.last_error()
        raise BridgeError(500, f"account_info() returned None [{code}]: {desc}")
    return {
        "login": i(info.login),
        "balance": r2(info.balance),
        "equity": r2(info.equity),
        "margin": r2(info.margin),
        "freeMargin": r2(info.margin_free),
        "marginLevel": r2(info.margin_level),
        "leverage": i(info.leverage),
        "currency": str(info.currency),
        "profit": r2(info.profit),
        "server": str(info.server),
        "name": str(info.name),
    }


def _symbol_info(sym: str):
    info = mt5.symbol_info(sym)
    if info is None:
        raise BridgeError(400, f"No symbol info for {sym}", 10013)
    return info


def _tick(sym: str):
    tick = mt5.symbol_info_tick(sym)
    if tick is None or (f(tick.bid) <= 0 and f(tick.ask) <= 0):
        raise BridgeError(400, f"No quotes to process request for {sym}", 10021)
    return tick


def _stops_distance(info) -> float:
    """Broker stops level (points) — falls back to the simulator's 10-tick rule."""
    stops_level = i(getattr(info, "trade_stops_level", 0))
    point = f(getattr(info, "point", 0.0)) or 1.0
    return max(stops_level, MIN_STOPS_POINTS) * point


def _pick_filling(info):
    """Pick a filling mode supported by the symbol (bitmask: 1=FOK, 2=IOC)."""
    mode = i(getattr(info, "filling_mode", 0))
    if mode & 1:
        return mt5.ORDER_FILLING_FOK
    if mode & 2:
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def _symbol_currency(info) -> str:
    for attr in ("currency_profit", "currency_margin", "currency_base"):
        val = str(getattr(info, attr, "") or "")
        if val:
            return val
    acct = mt5.account_info()
    return str(getattr(acct, "currency", "USD")) if acct else "USD"


def _get_position(ticket: int):
    """Fetch an open position by ticket (404 mirror when missing)."""
    positions = mt5.positions_get(ticket=int(ticket))
    if not positions:
        raise BridgeError(404, f"Position ticket {int(ticket)} not found", 10036)
    return positions[0]


def _direction_of_position(pos) -> str:
    return "BUY" if i(pos.type) == i(mt5.POSITION_TYPE_BUY) else "SELL"


# ============================================================
# SL/TP VALIDATION (mirrors the simulator's /order + /modify rules)
# ============================================================

def _validate_stops(direction: str, sl, tp, info, tick) -> None:
    """Reject SL/TP on the wrong side of the market (simulator messages, 10016)."""
    bid, ask = f(tick.bid), f(tick.ask)
    dist = _stops_distance(info)

    if sl is not None:
        if isinstance(sl, bool) or not isinstance(sl, (int, float)) or sl <= 0:
            raise BridgeError(400, "sl must be a positive number", 10016)
        if direction == "BUY" and f(sl) >= bid - dist:
            raise BridgeError(400, "SL for BUY must be below current bid", 10016)
        if direction == "SELL" and f(sl) <= ask + dist:
            raise BridgeError(400, "SL for SELL must be above current ask", 10016)

    if tp is not None:
        if isinstance(tp, bool) or not isinstance(tp, (int, float)) or tp <= 0:
            raise BridgeError(400, "tp must be a positive number", 10016)
        if direction == "BUY" and f(tp) <= ask + dist:
            raise BridgeError(400, "TP for BUY must be above current ask", 10016)
        if direction == "SELL" and f(tp) >= bid - dist:
            raise BridgeError(400, "TP for SELL must be below current bid", 10016)


def _validate_lot_size(lot_size) -> None:
    """Mirror of the simulator's validateLotSize() (messages + 10014)."""
    if isinstance(lot_size, bool) or not isinstance(lot_size, (int, float)):
        raise BridgeError(400, "lotSize must be a number", 10014)
    lot = f(lot_size)
    if lot < MIN_LOT:
        raise BridgeError(400, f"lotSize below minimum ({MIN_LOT:g})", 10014)
    if lot > MAX_LOT:
        raise BridgeError(400, f"lotSize exceeds maximum ({MAX_LOT:g})", 10014)
    steps = round(lot / LOT_STEP)
    if abs(steps * LOT_STEP - lot) > 1e-9:
        raise BridgeError(400, f"lotSize must be a multiple of {LOT_STEP:g}", 10014)


# ============================================================
# CORE HANDLERS (sync; run in the threadpool; MUST hold MT5_LOCK)
# ============================================================

def _parse_json(raw: bytes) -> dict:
    """Parse a request body → dict. Mirrors the simulator's 400
    'Invalid JSON body'; non-object JSON degrades to {} so field validation
    produces the same messages as the simulator's undefined-field path."""
    try:
        if not raw:
            raise ValueError("empty body")
        data = json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        raise BridgeError(400, "Invalid JSON body")
    return data if isinstance(data, dict) else {}


def core_connect(raw: bytes) -> dict:
    body = _parse_json(raw)
    login = body.get("login")
    password = body.get("password")
    server = body.get("server")

    if isinstance(login, bool) or not isinstance(login, (int, float)) or f(login) <= 0:
        raise BridgeError(400, "login must be a positive number")
    if not isinstance(password, str) or len(password) < 1:
        raise BridgeError(400, "password is required")
    if not isinstance(server, str) or len(server) < 1:
        raise BridgeError(400, "server is required")

    login = i(login)

    with MT5_LOCK:
        _ensure_mt5_package()
        started = time.monotonic()
        if not _mt5_login(login, password, server):
            code, desc = mt5.last_error()
            # Message contains the word "login" so the app's AUTH_FAILED
            # classifier (error.includes("login")) behaves correctly.
            raise BridgeError(401, f"MT5 login failed [{code}]: {desc}")
        latency_ms = int(round((time.monotonic() - started) * 1000))

        account = _account_info_dict()
        now_iso = utc_iso_now()
        SESSION.update(
            connected=True,
            login=login,
            server=server,
            name=account.get("name", ""),
            connect_time=now_iso,
            connect_ms=time.time() * 1000.0,
            latency_ms=latency_ms,
        )

        log_op("CONNECT", f"login={login} server={server} latency={latency_ms}ms")

        return {
            "connected": True,
            "account": account,
            "connectTime": now_iso,
            "latencyMs": latency_ms,
            "server": server,
        }


def core_heartbeat() -> dict:
    with MT5_LOCK:
        _ensure_ready()

        started = time.monotonic()
        account = _account_info_dict()
        latency_ms = int(round((time.monotonic() - started) * 1000))

        open_positions = i(mt5.positions_total())
        SESSION["latency_ms"] = latency_ms

        uptime_ms = int(time.time() * 1000.0 - SESSION["connect_ms"]) if SESSION["connect_ms"] else 0

        return {
            "connected": True,
            "latencyMs": latency_ms,
            "uptimeMs": max(uptime_ms, 0),
            "account": account,
            "openPositions": open_positions,
        }


def core_disconnect() -> dict:
    with MT5_LOCK:
        _ensure_ready()
        log_op("DISCONNECT", f"login={SESSION['login']}")
        try:
            mt5.shutdown()
        finally:
            IPC_INITIALIZED["ok"] = False
            SESSION.update(connected=False, login=0, server="", name="",
                           connect_time=None, connect_ms=0.0, latency_ms=0)
        return {"disconnected": True}


def core_order(raw: bytes) -> dict:
    with MT5_LOCK:
        # Session gate FIRST, then JSON parse + validation — the simulator's
        # exact ordering (requireSession → req.json() → field checks).
        _ensure_ready()
        body = _parse_json(raw)

        symbol = body.get("symbol")
        direction = body.get("direction")
        lot_size = body.get("lotSize", 0)
        sl = body.get("sl")
        tp = body.get("tp")
        comment = body.get("comment", "")

        # Symbol validation (mirrors simulator messages, 10013)
        sym = str(symbol).upper() if symbol is not None else ""
        if sym not in BRIDGE_SYMBOLS:
            valid = ", ".join(BRIDGE_SYMBOLS)
            raise BridgeError(400, f"Unknown symbol: {symbol}. Valid: {valid}", 10013)

        # Direction validation
        direction = str(direction).upper() if direction is not None else ""
        if direction not in ("BUY", "SELL"):
            raise BridgeError(400, "direction must be BUY or SELL", 10013)

        # Lot validation
        _validate_lot_size(lot_size)
        volume = f(lot_size)

        if comment is None:
            comment = ""
        if not isinstance(comment, str):
            comment = str(comment)

        info = _symbol_info(sym)
        tick = _tick(sym)
        bid, ask = f(tick.bid), f(tick.ask)

        # SL/TP sanity vs live market (mirrors simulator)
        _validate_stops(direction, sl, tp, info, tick)

        order_type = mt5.ORDER_TYPE_BUY if direction == "BUY" else mt5.ORDER_TYPE_SELL
        price = ask if direction == "BUY" else bid

        # Margin pre-check (mirrors simulator's 10019 path; broker remains
        # the final authority — order_calc_margin may be unsupported).
        try:
            required_margin = mt5.order_calc_margin(order_type, sym, volume, price)
        except Exception:
            required_margin = None
        if required_margin is not None:
            acct = mt5.account_info()
            if acct is not None and f(required_margin) > f(acct.margin_free):
                raise BridgeError(400, "Not enough margin for this trade", 10019)

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": sym,
            "volume": volume,
            "type": order_type,
            "price": price,
            "sl": f(sl) if sl is not None else 0.0,
            "tp": f(tp) if tp is not None else 0.0,
            "deviation": BRIDGE_DEVIATION,
            "magic": BRIDGE_MAGIC,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": _pick_filling(info),
        }

        result = mt5.order_send(request)
        if result is None:
            code, desc = mt5.last_error()
            raise BridgeError(500, f"order_send() failed [{code}]: {desc}")

        retcode = i(result.retcode)
        if retcode != TRADE_RETCODE_DONE:
            desc = mt5_error_desc(retcode)
            raise BridgeError(400, f"Order rejected: {desc} (retcode {retcode})", retcode)

        # Position ticket: on hedging accounts the opening order ticket IS
        # the position ticket. Verify against the terminal; on netting
        # accounts an ADD merges into an older position — if exactly one
        # position exists on the symbol, treat it as the merged position.
        ticket = i(result.order)
        try:
            opened = mt5.positions_get(ticket=ticket)
            if opened:
                ticket = i(opened[0].ticket)
            else:
                candidates = mt5.positions_get(symbol=sym) or []
                if len(candidates) == 1:
                    ticket = i(candidates[0].ticket)
                    log_op("ORDER", f"netting account — merged into position {ticket}")
                else:
                    log_op("ORDER", f"position for order {ticket} not found yet "
                                    f"(candidates={len(candidates)})")
        except Exception:
            pass

        # Fill price: prefer the executed deal price, then the result price,
        # then the requested tick price (documented fallback chain).
        open_price = f(price)
        fill_volume = volume
        commission = 0.0
        try:
            deal_ticket = i(result.deal)
            if deal_ticket:
                deals = mt5.history_deals_get(ticket=deal_ticket)
                if deals:
                    deal = deals[0]
                    if f(deal.price) > 0:
                        open_price = f(deal.price)
                    if f(deal.volume) > 0:
                        fill_volume = f(deal.volume)
                    commission = r2(deal.commission)
        except Exception:
            pass
        if f(result.price) > 0 and open_price == f(price):
            open_price = f(result.price)
        if f(result.volume) > 0:
            fill_volume = f(result.volume)

        digits = i(getattr(info, "digits", 2))
        slippage = round(abs(open_price - price), digits) if open_price else 0.0
        open_time = utc_iso_epoch(i(result.time) or i(time.time()))

        log_op("ORDER", f"ticket={ticket} {direction} {sym} lot={fill_volume} "
                        f"price={open_price} slippage={slippage}")

        return {
            "ticket": ticket,
            "symbol": sym,
            "direction": direction,
            "lotSize": fill_volume,
            "openPrice": open_price,
            # Additive echoes (app reads them if present):
            "price": open_price,
            "sl": f(sl) if sl is not None else None,
            "tp": f(tp) if tp is not None else None,
            "slippage": slippage,
            "commission": commission,
            "openTime": open_time,
            "comment": comment,
            "retcode": TRADE_RETCODE_DONE,
            "retcodeDescription": mt5_error_desc(TRADE_RETCODE_DONE),
            "account": _account_info_dict(),
        }


def _close_position_locked(pos) -> dict:
    """Close one position (opposite-side DEAL). Caller MUST hold MT5_LOCK."""
    sym = str(pos.symbol)
    direction = _direction_of_position(pos)
    ticket = i(pos.ticket)
    volume = f(pos.volume)
    open_price = f(pos.price_open)

    info = _symbol_info(sym)
    tick = _tick(sym)
    bid, ask = f(tick.bid), f(tick.ask)

    close_type = mt5.ORDER_TYPE_SELL if direction == "BUY" else mt5.ORDER_TYPE_BUY
    request_price = bid if direction == "BUY" else ask

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": sym,
        "volume": volume,
        "type": close_type,
        "position": ticket,
        "price": request_price,
        "deviation": BRIDGE_DEVIATION,
        "magic": BRIDGE_MAGIC,
        "comment": "bridge-close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _pick_filling(info),
    }

    result = mt5.order_send(request)
    if result is None:
        code, desc = mt5.last_error()
        raise BridgeError(500, f"order_send() failed [{code}]: {desc}")

    retcode = i(result.retcode)
    if retcode != TRADE_RETCODE_DONE:
        desc = mt5_error_desc(retcode)
        raise BridgeError(400, f"Close rejected: {desc} (retcode {retcode})", retcode)

    # Realized P&L from the closing deal (fallback: result price, P&L 0).
    close_price = f(result.price) or request_price
    profit = 0.0
    swap = 0.0
    commission = 0.0
    close_time = utc_iso_epoch(i(result.time) or i(time.time()))
    try:
        deals = mt5.history_deals_get(position=ticket)
        if deals:
            out_deals = [d for d in deals
                         if i(d.entry) in (i(mt5.DEAL_ENTRY_OUT),
                                           i(mt5.DEAL_ENTRY_OUT_BY),
                                           i(mt5.DEAL_ENTRY_INOUT))]
            if out_deals:
                out = out_deals[-1]
                if f(out.price) > 0:
                    close_price = f(out.price)
                profit = r2(f(out.profit) + f(out.swap) + f(out.commission))
                swap = r2(out.swap)
                commission = r2(sum(f(d.commission) for d in deals if str(d.symbol) == sym))
                close_time = utc_iso_epoch(i(out.time))
    except Exception as exc:  # noqa: BLE001 — best-effort enrichment
        log_op("CLOSE", f"ticket={ticket} deal lookup failed: {exc}")

    digits = i(getattr(info, "digits", 2))
    slippage = round(abs(close_price - request_price), digits) if close_price else 0.0

    log_op("CLOSE", f"ticket={ticket} {sym} closePrice={close_price} "
                    f"profit={profit} slippage={slippage}")

    return {
        "ticket": ticket,
        "symbol": sym,
        "direction": direction,
        "lotSize": volume,
        "openPrice": open_price,
        "closePrice": close_price,
        "slippage": slippage,
        "profit": profit,
        "commission": commission,
        "closeTime": close_time,
        "retcode": TRADE_RETCODE_DONE,
        "retcodeDescription": mt5_error_desc(TRADE_RETCODE_DONE),
    }


def core_close(raw: bytes) -> dict:
    with MT5_LOCK:
        _ensure_ready()
        body = _parse_json(raw)

        ticket = body.get("ticket")
        if isinstance(ticket, bool) or not isinstance(ticket, (int, float)) or f(ticket) <= 0:
            raise BridgeError(400, "ticket must be a positive number", 10035)
        ticket = i(ticket)

        pos = _get_position(ticket)  # 404 + 10036 mirror when missing
        data = _close_position_locked(pos)
        data["account"] = _account_info_dict()
        return data


def core_modify(raw: bytes) -> dict:
    with MT5_LOCK:
        _ensure_ready()
        body = _parse_json(raw)

        ticket = body.get("ticket")
        if isinstance(ticket, bool) or not isinstance(ticket, (int, float)) or f(ticket) <= 0:
            raise BridgeError(400, "ticket must be a positive number", 10035)
        ticket = i(ticket)

        sl = body.get("sl")  # semantics: absent → keep, None → clear, number → set
        tp = body.get("tp")

        pos = _get_position(ticket)  # 404 + 10036 mirror when missing

        direction = _direction_of_position(pos)
        sym = str(pos.symbol)
        info = _symbol_info(sym)
        tick = _tick(sym)

        # Same SL/TP sanity rules as /order (mirrors simulator).
        _validate_stops(direction, sl, tp, info, tick)

        # Semantics mirror of the simulator's /modify:
        #   key absent → keep current value; null → clear (0.0); number → set.
        if "sl" not in body:
            new_sl = f(pos.sl)
        elif sl is None:
            new_sl = 0.0
        else:
            new_sl = f(sl)

        if "tp" not in body:
            new_tp = f(pos.tp)
        elif tp is None:
            new_tp = 0.0
        else:
            new_tp = f(tp)

        request = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": ticket,
            "symbol": sym,
            "sl": new_sl if new_sl > 0 else 0.0,
            "tp": new_tp if new_tp > 0 else 0.0,
        }

        result = mt5.order_send(request)
        if result is None:
            code, desc = mt5.last_error()
            raise BridgeError(500, f"order_send() failed [{code}]: {desc}")

        retcode = i(result.retcode)
        if retcode != TRADE_RETCODE_DONE:
            desc = mt5_error_desc(retcode)
            raise BridgeError(400, f"Modify rejected: {desc} (retcode {retcode})", retcode)

        # Re-fetch the position for the final SL/TP (0.0 → null, mirroring
        # the simulator's number|null).
        final_sl = f(new_sl) if new_sl > 0 else None
        final_tp = f(new_tp) if new_tp > 0 else None
        try:
            refreshed = _get_position(ticket)
            final_sl = f(refreshed.sl) if f(refreshed.sl) > 0 else None
            final_tp = f(refreshed.tp) if f(refreshed.tp) > 0 else None
        except BridgeError:
            pass  # position vanished mid-refresh — echo the requested values

        log_op("MODIFY", f"ticket={ticket} sl={final_sl} tp={final_tp}")

        return {
            "ticket": ticket,
            "symbol": sym,
            "sl": final_sl,
            "tp": final_tp,
            "retcode": TRADE_RETCODE_DONE,
            "retcodeDescription": mt5_error_desc(TRADE_RETCODE_DONE),
        }


def core_close_all() -> dict:
    with MT5_LOCK:
        _ensure_ready()

        positions = mt5.positions_get() or []
        if not positions:
            return {"closed": 0, "message": "No open positions"}

        trades = []
        tickets = []
        for pos in positions:
            tickets.append(i(pos.ticket))
            try:
                data = _close_position_locked(pos)
                trades.append({
                    "ticket": data["ticket"],
                    "symbol": data["symbol"],
                    "direction": data["direction"],
                    "lotSize": data["lotSize"],
                    "openPrice": data["openPrice"],
                    "closePrice": data["closePrice"],
                    "profit": data["profit"],
                    "slippage": data["slippage"],
                })
            except BridgeError as exc:
                # A single frozen/locked position must not abort the sweep —
                # log and skip it (deviation from the simulator, which cannot
                # fail mid-loop; documented in README).
                log_op("CLOSE-ALL", f"skip ticket={i(pos.ticket)} error={exc.message}")

        log_op("CLOSE-ALL", f"closed={len(trades)} tickets=[{','.join(str(t) for t in tickets)}]")

        return {
            "closed": len(trades),
            "trades": trades,
            "account": _account_info_dict(),
        }


def core_positions() -> dict:
    with MT5_LOCK:
        _ensure_ready()

        positions = mt5.positions_get() or []
        result = []
        total_profit = 0.0

        for pos in positions:
            sym = str(pos.symbol)
            bid = ask = 0.0
            description = ""
            try:
                info = _symbol_info(sym)
                description = str(getattr(info, "description", "") or "")
                tick = mt5.symbol_info_tick(sym)
                if tick is not None:
                    bid, ask = f(tick.bid), f(tick.ask)
            except BridgeError:
                pass  # quote hiccup — still report the position itself

            profit = f(pos.profit)
            total_profit += profit
            result.append({
                "ticket": i(pos.ticket),
                "symbol": sym,
                "sector": "UNKNOWN",  # MT5 has no sector field (documented)
                "description": description,
                "direction": _direction_of_position(pos),
                "lotSize": f(pos.volume),
                "openPrice": f(pos.price_open),
                "currentBid": bid,
                "currentAsk": ask,
                "sl": f(pos.sl) if f(pos.sl) > 0 else None,
                "tp": f(pos.tp) if f(pos.tp) > 0 else None,
                "profit": r2(profit),
                "commission": 0.0,  # charged on deals, not positions (documented)
                "openTime": utc_iso_epoch(i(pos.time)),
                "comment": str(getattr(pos, "comment", "") or ""),
            })

        return {
            "positions": result,
            "count": len(result),
            "totalProfit": r2(total_profit),
        }


def core_account() -> dict:
    with MT5_LOCK:
        _ensure_ready()
        return _account_info_dict()


def core_prices() -> dict:
    with MT5_LOCK:
        _ensure_ready()

        now_iso = utc_iso_now()
        prices = {}
        for sym in BRIDGE_SYMBOLS:
            try:
                tick = _tick(sym)
            except BridgeError:
                log_op("PRICES", f"no quotes for {sym} — skipped")
                continue
            bid, ask = f(tick.bid), f(tick.ask)
            prices[sym] = {
                "bid": bid,
                "ask": ask,
                "spread": round(ask - bid, 8),
                "timestamp": now_iso,
            }
        return prices


def core_symbol_info(raw_symbol: str) -> dict:
    sym = str(raw_symbol).upper()

    with MT5_LOCK:
        # Session gate first, then symbol lookup — the simulator's ordering.
        _ensure_ready()

        if sym not in BRIDGE_SYMBOLS:
            valid = ", ".join(BRIDGE_SYMBOLS)
            raise BridgeError(404, f"Symbol not found: {raw_symbol}. Valid: {valid}", 10013)

        try:
            info = _symbol_info(sym)
        except BridgeError:
            valid = ", ".join(BRIDGE_SYMBOLS)
            raise BridgeError(404, f"Symbol not found: {raw_symbol}. Valid: {valid}", 10013)

        tick = _tick(sym)
        bid, ask = f(tick.bid), f(tick.ask)

        leverage = 0
        currency = _symbol_currency(info)
        try:
            acct = mt5.account_info()
            if acct is not None:
                leverage = i(acct.leverage)
                if not currency:
                    currency = str(acct.currency)
        except Exception:
            pass

        point = f(getattr(info, "point", 0.0)) or 1.0
        tick_size = f(getattr(info, "trade_tick_size", 0.0)) or point

        return {
            # Simulator field names:
            "symbol": str(info.name),
            "sector": "UNKNOWN",  # MT5 has no sector field (documented)
            "description": str(getattr(info, "description", "") or ""),
            "lotSize": f(getattr(info, "trade_contract_size", 0.0)),
            "tickSize": tick_size,
            "bid": bid,
            "ask": ask,
            "spread": round(ask - bid, 8),
            "minLot": f(getattr(info, "volume_min", MIN_LOT)),
            "maxLot": f(getattr(info, "volume_max", MAX_LOT)),
            "lotStep": f(getattr(info, "volume_step", LOT_STEP)),
            "leverage": leverage,
            "commissionPerLot": BRIDGE_COMMISSION_PER_LOT,  # informational echo
            "currency": currency,
            # Additive fields (app's SymbolMappingEntry naming + digits):
            "idxSymbol": sym,
            "mt5Symbol": str(info.name),
            "digits": i(getattr(info, "digits", 2)),
        }


def core_history() -> dict:
    with MT5_LOCK:
        _ensure_ready()

        now = datetime.now(timezone.utc)
        since = now - timedelta(days=BRIDGE_HISTORY_DAYS)
        deals = mt5.history_deals_get(since, now) or []

        opens = {}
        closes = {}
        for d in deals:
            pid = i(d.position_id)
            if pid == 0 or not str(d.symbol):
                continue  # balance/credit operations
            entry = i(d.entry)
            if entry == i(mt5.DEAL_ENTRY_IN):
                opens[pid] = d
            elif entry in (i(mt5.DEAL_ENTRY_OUT), i(mt5.DEAL_ENTRY_OUT_BY),
                           i(mt5.DEAL_ENTRY_INOUT)):
                # Partial closes emit several OUT deals for one position —
                # aggregate them below.
                closes.setdefault(pid, []).append(d)

        trades = []
        for pid, out_deals in closes.items():
            out_deals.sort(key=lambda d: i(d.time))
            out = out_deals[-1]  # latest close deal
            out_profit = sum(f(d.profit) for d in out_deals)
            out_swap = sum(f(d.swap) for d in out_deals)
            out_commission = sum(f(d.commission) for d in out_deals)

            entry_in = opens.get(pid)
            if entry_in is None:
                # Position opened before the lookback window — report the
                # close; the position direction is the inverse of the
                # closing-deal side (a BUY position closes via a SELL deal).
                direction = "BUY" if i(out.type) == i(mt5.DEAL_TYPE_SELL) else "SELL"
                open_volume, open_price = f(out.volume), f(out.price)
                open_time = utc_iso_epoch(i(out.time))
                in_commission = 0.0
                open_comment = str(getattr(out, "comment", "") or "")
            else:
                direction = "BUY" if i(entry_in.type) == i(mt5.DEAL_TYPE_BUY) else "SELL"
                open_volume, open_price = f(entry_in.volume), f(entry_in.price)
                open_time = utc_iso_epoch(i(entry_in.time))
                in_commission = f(entry_in.commission)
                open_comment = str(getattr(entry_in, "comment", "") or "")

            commission = r2(in_commission + out_commission)
            net_profit = r2(out_profit + out_swap + in_commission + out_commission)
            trades.append({
                "ticket": pid,
                "symbol": str(out.symbol),
                "direction": direction,
                "lotSize": open_volume,
                "openPrice": open_price,
                "openTime": open_time,
                "sl": None,   # MT5 deals do not carry SL/TP (documented)
                "tp": None,
                "comment": str(getattr(out, "comment", "") or open_comment),
                "commission": commission,
                "closePrice": f(out.price),
                "closeTime": utc_iso_epoch(i(out.time)),
                "profit": net_profit,
                "swap": r2(out_swap),
                "slippage": 0.0,  # not reported by MT5 deal history (documented)
            })

        trades.sort(key=lambda t: (t["closeTime"], t["ticket"]), reverse=True)
        trades = trades[:BRIDGE_MAX_HISTORY]  # mirror simulator's last-100 cap

        return {
            "trades": trades,
            "count": len(trades),
            "totalRealizedProfit": r2(sum(t["profit"] for t in trades)),
        }


# ============================================================
# FASTAPI APP + CORS (mirrors the simulator's headers exactly)
# ============================================================

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


def _init_symbols() -> None:
    """Initialize terminal IPC + enable Market Watch for the symbol universe."""
    with MT5_LOCK:
        if not _mt5_initialize():
            log_op("STARTUP", "terminal not available yet — waiting for POST /connect")
            return
        for sym in BRIDGE_SYMBOLS:
            try:
                if not mt5.symbol_select(sym, True):
                    log_op("STARTUP", f"symbol_select({sym}) failed — quotes may be missing")
            except Exception as exc:  # noqa: BLE001
                log_op("STARTUP", f"symbol_select({sym}) error: {exc}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # ---- startup ----
    if not MT5_AVAILABLE:
        log_op("FATAL", "MetaTrader5 package not available — install with "
                        "'pip install -r requirements.txt' on Windows")
        raise RuntimeError("MetaTrader5 package is not available (Windows-only)")

    log_op("STARTUP", f"symbols={','.join(BRIDGE_SYMBOLS)} deviation={BRIDGE_DEVIATION} "
                      f"magic={BRIDGE_MAGIC} historyDays={BRIDGE_HISTORY_DAYS}")

    await run_in_threadpool(_init_symbols)

    # Optional auto-connect from env credentials.
    if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
        try:
            creds = json.dumps({"login": int(MT5_LOGIN), "password": MT5_PASSWORD,
                                "server": MT5_SERVER}).encode()
            data = await run_in_threadpool(core_connect, creds)
            log_op("STARTUP", f"auto-connected login={data.get('login')}")
        except BridgeError as exc:
            log_op("STARTUP", f"auto-connect failed: {exc.message}")
        except ValueError:
            log_op("STARTUP", f"auto-connect skipped — MT5_LOGIN is not a number: {MT5_LOGIN!r}")

    yield

    # ---- shutdown ----
    log_op("SHUTDOWN", "graceful shutdown")
    try:
        with MT5_LOCK:
            if IPC_INITIALIZED["ok"]:
                mt5.shutdown()
                IPC_INITIALIZED["ok"] = False
    except Exception as exc:  # noqa: BLE001
        log_op("SHUTDOWN", f"mt5.shutdown() error: {exc}")


app = FastAPI(title="MT5 Bridge — FINEX Indonesia", redirect_slashes=False,
              lifespan=lifespan)


@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    # Mirror of the simulator's router: ANY OPTIONS → 204 + Max-Age.
    if request.method == "OPTIONS":
        return Response(status_code=204, headers={**CORS_HEADERS,
                                                  "Access-Control-Max-Age": "86400"})
    response = await call_next(request)
    for key, value in CORS_HEADERS.items():
        response.headers[key] = value
    return response


async def run_core(core, *args):
    """Run a sync core in the threadpool; map BridgeError → envelope; catch-all → 500."""
    try:
        data = await run_in_threadpool(core, *args)
        return json_response({"success": True, "data": data})
    except BridgeError as exc:
        return error_response(exc.status_code, exc.message, exc.mt5_code)
    except Exception as exc:  # noqa: BLE001 — mirror of simulator catch-all
        return internal_error(exc)


# ============================================================
# ROUTES (thin async wrappers — identical paths & methods)
# ============================================================

@app.post("/connect")
async def connect(request: Request):
    return await run_core(core_connect, await request.body())


@app.get("/heartbeat")
async def heartbeat():
    return await run_core(core_heartbeat)


@app.post("/disconnect")
async def disconnect():
    return await run_core(core_disconnect)


@app.post("/order")
async def order(request: Request):
    return await run_core(core_order, await request.body())


@app.post("/close")
async def close(request: Request):
    return await run_core(core_close, await request.body())


@app.post("/modify")
async def modify(request: Request):
    return await run_core(core_modify, await request.body())


@app.post("/close-all")
async def close_all():
    return await run_core(core_close_all)


@app.get("/positions")
async def positions():
    return await run_core(core_positions)


@app.get("/account")
async def account():
    return await run_core(core_account)


@app.get("/prices")
async def prices():
    return await run_core(core_prices)


@app.get("/symbol-info/{symbol}")
async def symbol_info(symbol: str):
    return await run_core(core_symbol_info, symbol)


@app.get("/history")
async def history():
    return await run_core(core_history)


# Catch-all 404 — registered LAST so specific routes win; mirrors the
# simulator's `Not found: <method> <path>` (method mismatches also 404 here,
# because the catch-all FULL-matches where the specific route only PARTIAL-
# matches — same observable behavior as the simulator's fallthrough).
@app.api_route("/{full_path:path}",
               methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
async def not_found(full_path: str, request: Request):
    return error_response(404, f"Not found: {request.method} /{full_path}")


# Safety net for anything escaping the route-level catch-all (keeps the JSON
# envelope contract even for framework-level errors).
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return internal_error(exc)


# ============================================================
# SERVER START (mirror of the simulator's console banner)
# ============================================================

def print_banner() -> None:
    print("=" * 60)
    print("  MT5 Bridge — FINEX Indonesia (Real MetaTrader 5)")
    print(f"  Port: {BRIDGE_PORT}")
    print(f"  Symbols: {len(BRIDGE_SYMBOLS)} ({', '.join(BRIDGE_SYMBOLS)})")
    print(f"  Deviation: {BRIDGE_DEVIATION} points")
    print(f"  Magic: {BRIDGE_MAGIC}")
    print(f"  History: {BRIDGE_HISTORY_DAYS} days (max {BRIDGE_MAX_HISTORY} trades)")
    if MT5_LOGIN:
        print(f"  Auto-connect: login {MT5_LOGIN} @ {MT5_SERVER or '(unset)'}")
    print("=" * 60)


print_banner()


if __name__ == "__main__":
    import uvicorn

    if not MT5_AVAILABLE:
        print("FATAL: the MetaTrader5 package is required (Windows only). "
              "Install dependencies: pip install -r requirements.txt",
              file=sys.stderr)
        sys.exit(1)

    print(f"[{utc_iso_now()}] MT5 Bridge server listening on port {BRIDGE_PORT}",
          flush=True)
    # Single worker — the MetaTrader5 IPC must not be multiplied across processes.
    uvicorn.run(app, host="0.0.0.0", port=BRIDGE_PORT, access_log=False)
