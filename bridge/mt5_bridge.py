"""
mt5_bridge.py — MT5 Python Bridge untuk AI Forex Trading Dashboard (FINEX Indonesia)

Menjembatani dashboard web (http://localhost:3000) dengan terminal MetaTrader 5:
  1. Baca kredensial MT5 dari SQLite DB dashboard (db/custom.db).
  2. Launch terminal64.exe bila auto-start aktif dan terminal belum berjalan.
  3. MetaTrader5.initialize(path) + MetaTrader5.login(acc, pwd, server).
  4. Loop 2 detik: sync account_info() ke DB + eksekusi order baru dari dashboard.
  5. Graceful shutdown: MetaTrader5.shutdown() + taskkill terminal.

Jalankan:  python mt5_bridge.py
Hentikan:  Ctrl+C  (bridge akan shutdown MT5 dengan rapi)
"""

from __future__ import annotations

import logging
import os
import signal
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
import MetaTrader5 as mt5

# ----------------------------- Konfigurasi ---------------------------------
# Path ke SQLite DB dashboard. Auto-detected: cari db/custom.db relatif terhadap
# lokasi script ini (bridge/mt5_bridge.py -> ../db/custom.db). Override via
# environment variable DASHBOARD_DB bila perlu.
_SCRIPT_DIR = Path(__file__).resolve().parent          # .../frxai/bridge
_PROJECT_ROOT = _SCRIPT_DIR.parent                      # .../frxai
_AUTO_DB_PATH = _PROJECT_ROOT / "db" / "custom.db"      # .../frxai/db/custom.db

DB_PATH = os.environ.get("DASHBOARD_DB", str(_AUTO_DB_PATH))
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000")
POLL_INTERVAL = float(os.environ.get("BRIDGE_POLL_INTERVAL", "2"))
TERMINAL_WARMUP_SEC = 8
LOG_FILE = _SCRIPT_DIR / "mt5_bridge.log"
MAGIC_NUMBER = 20251101  # magic number bridge — filter posisi milik bridge

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8"), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("mt5_bridge")

# ------------------------------ State bridge -------------------------------
synced_tickets: set[str] = set()      # ticket dashboard yang sudah dikirim ke MT5
terminal_pid: Optional[int] = None    # pid terminal yang diluncurkan bridge
running: bool = True                  # flag loop utama


# ----------------------- Helper: akses SQLite DB ---------------------------
def db() -> sqlite3.Connection:
    """Buka koneksi ke SQLite dashboard. Prisma schema: tabel Account (1 baris)."""
    if not Path(DB_PATH).exists():
        raise FileNotFoundError(
            f"DB dashboard tidak ditemukan: {DB_PATH}\n"
            f"\nSolusi:\n"
            f"  1. Pastikan dashboard sudah pernah dijalankan (npm run dev) sekali\n"
            f"     agar Prisma membuat file db/custom.db\n"
            f"  2. Atau set environment variable DASHBOARD_DB ke path yang benar:\n"
            f'     set DASHBOARD_DB=C:\\Users\\Anda\\frxai\\db\\custom.db\n'
            f"  3. Lokasi script sekarang: {_SCRIPT_DIR}\n"
            f"  4. Project root terdeteksi: {_PROJECT_ROOT}"
        )
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def load_credentials() -> dict[str, Any]:
    """Baca kredensial MT5 dari tabel Account. Password dibaca plain-text karena
    bridge & dashboard satu mesin (GET /api/mt5/credentials mengembalikan mask)."""
    with db() as c:
        row = c.execute(
            "SELECT mt5Account, mt5Password, mt5Server, mt5AccountType, mt5Terminal, "
            "       mt5TerminalPath, mt5AutoStartTerminal, mt5TerminalRunning, "
            "       mt5TerminalPid, mt5Connected FROM Account LIMIT 1"
        ).fetchone()
    if row is None:
        raise RuntimeError("Tabel Account kosong. Buka dashboard sekali untuk init.")
    return dict(row)


def write_account_state(balance: float, equity: float, margin: float,
                        free_margin: float, margin_level: float,
                        terminal_running: bool, terminal_pid_val: Optional[int]) -> None:
    """Tulis kembali account_info() MT5 ke tabel Account + flag terminal running."""
    with db() as c:
        c.execute(
            "UPDATE Account SET balance=?, equity=?, margin=?, freeMargin=?, "
            "marginLevel=?, mt5TerminalRunning=?, mt5TerminalPid=?, updatedAt=?",
            (balance, equity, margin, free_margin, margin_level,
             1 if terminal_running else 0, terminal_pid_val,
             datetime.now(timezone.utc).isoformat()),
        )
        c.commit()


def update_trade_ticket(dashboard_ticket: str, mt5_ticket: int, open_price: float) -> None:
    """Update baris Trade dengan ticket MT5 asli + harga eksekusi."""
    with db() as c:
        c.execute("UPDATE Trade SET ticket=?, openPrice=? WHERE ticket=?",
                  (str(mt5_ticket), open_price, dashboard_ticket))
        c.commit()


def mark_trade_closed(mt5_ticket: int, close_price: float, pnl: float) -> None:
    """Tandai Trade sebagai CLOSED ketika posisi hilang dari MT5.
    P0-H2: Also update Account.balance + dailyLossUsed so broker-side closes
    (SL/TP hit) are reflected in the Anti-MC tracking."""
    with db() as c:
        # Get the trade's reserved margin to release
        row = c.execute(
            "SELECT lotSize, openPrice, symbol, marginUsed FROM Trade "
            "WHERE ticket=? AND status='OPEN'",
            (str(mt5_ticket),),
        ).fetchone()
        if row is None:
            return  # already closed or not found

        c.execute(
            "UPDATE Trade SET status='CLOSED', closePrice=?, pnl=?, closedAt=? "
            "WHERE ticket=? AND status='OPEN'",
            (close_price, pnl, datetime.now(timezone.utc).isoformat(), str(mt5_ticket)),
        )

        # Release margin + update balance + dailyLossUsed
        acc = c.execute("SELECT balance, margin, freeMargin, dailyLossUsed FROM Account LIMIT 1").fetchone()
        if acc:
            margin_to_release = row["marginUsed"] if row["marginUsed"] else (row["lotSize"] * 100000 * row["openPrice"]) / 500
            new_balance = acc["balance"] + pnl
            new_margin = max(0, acc["margin"] - margin_to_release)
            new_free_margin = acc["freeMargin"] + margin_to_release
            # Increment dailyLossUsed if this was a losing trade
            daily_loss_inc = (abs(pnl) / acc["balance"] * 100) if pnl < 0 and acc["balance"] > 0 else 0
            new_daily_loss = acc["dailyLossUsed"] + daily_loss_inc
            c.execute(
                "UPDATE Account SET balance=?, equity=?, margin=?, freeMargin=?, dailyLossUsed=? WHERE id=1",
                (new_balance, new_balance, new_margin, new_free_margin, new_daily_loss),
            )
        c.commit()
        log.info(f"Broker-side close: ticket={mt5_ticket} PnL={pnl} dailyLossUsed now {new_daily_loss:.2f}%")


# -------------------------- Helper: dashboard API --------------------------
def api_get(path: str) -> dict[str, Any]:
    """GET ke endpoint dashboard. Return JSON atau {}."""
    try:
        r = requests.get(f"{DASHBOARD_URL}{path}", timeout=5)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning(f"GET {path} gagal: {e}")
        return {}


def api_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """POST ke endpoint dashboard. Return JSON atau {}."""
    try:
        r = requests.post(f"{DASHBOARD_URL}{path}", json=body, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning(f"POST {path} gagal: {e}")
        return {}


# --------------------- Manajemen terminal MT5 (exe) ------------------------
def launch_terminal(path: str) -> Optional[int]:
    """Launch terminal64.exe via subprocess.Popen. Return OS pid atau None."""
    if not Path(path).exists():
        log.error(f"Path terminal tidak ditemukan: {path}")
        return None
    try:
        proc = subprocess.Popen([path], cwd=str(Path(path).parent),
                                creationflags=subprocess.DETACHED_PROCESS)
        log.info(f"Terminal MT5 diluncurkan: {path} (PID {proc.pid})")
        return proc.pid
    except Exception as e:
        log.error(f"Gagal launch terminal: {e}")
        return None


def kill_terminal(pid: int) -> None:
    """Kill terminal64.exe via taskkill (Windows)."""
    try:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                       capture_output=True, timeout=10)
        log.info(f"Terminal MT5 dihentikan (PID {pid})")
    except Exception as e:
        log.warning(f"Gagal kill terminal PID {pid}: {e}")


# ------------------------------ Koneksi MT5 --------------------------------
def connect_mt5(creds: dict[str, Any]) -> bool:
    """Initialize + login ke MT5. Return True bila sukses."""
    terminal_path = creds.get("mt5TerminalPath") or ""
    account = creds.get("mt5Account") or ""
    password = creds.get("mt5Password") or ""
    server = creds.get("mt5Server") or "FINEX-Live01"
    if not (account and password):
        log.error("Kredensial MT5 belum lengkap. Isi di Settings -> Broker / MT5.")
        return False

    init_kwargs: dict[str, Any] = {}
    if terminal_path and Path(terminal_path).exists():
        init_kwargs["path"] = terminal_path
        log.info(f"Initialize MT5 dengan terminal: {terminal_path}")
    if not mt5.initialize(**init_kwargs):
        log.error(f"initialize() gagal: {mt5.last_error()}")
        return False
    if not mt5.login(login=int(account), password=password, server=server):
        log.error(f"login() gagal: {mt5.last_error()}  (akun={account}, server={server})")
        mt5.shutdown()
        return False

    info = mt5.account_info()
    if info is None:
        log.error("account_info() return None setelah login.")
        return False
    log.info(f"MT5 terhubung: login={info.login} server={info.server} "
             f"balance={info.balance} {info.currency} leverage=1:{info.leverage}")
    return True


# --------------------------- Sinkronisasi akun -----------------------------
def sync_account_state() -> None:
    """Baca account_info() dari MT5, tulis ke DB dashboard."""
    info = mt5.account_info()
    if info is None:
        log.warning("account_info() None - koneksi MT5 mungkin terputus.")
        return
    write_account_state(
        balance=float(info.balance), equity=float(info.equity),
        margin=float(info.margin), free_margin=float(info.margin_free),
        margin_level=float(info.margin_level) if info.margin_level else 0.0,
        terminal_running=True, terminal_pid_val=terminal_pid,
    )


# ------------------------- Eksekusi order dashboard ------------------------
SIDE_TO_MT5 = {"BUY": mt5.ORDER_TYPE_BUY, "SELL": mt5.ORDER_TYPE_SELL}


def fetch_pending_orders() -> list[dict[str, Any]]:
    """Ambil trade OPEN dari dashboard yang belum dikirim ke MT5."""
    data = api_get("/api/trade/list")
    trades = data.get("trades", []) if data else []
    pending = []
    for t in trades:
        if t.get("status") != "OPEN":
            continue
        if t.get("ticket") in synced_tickets:
            continue
        # Skip bila ticket sudah format angka murni (kemungkinan sudah ticket MT5 asli).
        if str(t.get("ticket", "")).isdigit() and len(str(t.get("ticket"))) >= 8:
            synced_tickets.add(t["ticket"])
            continue
        pending.append(t)
    return pending


def send_order_to_mt5(trade: dict[str, Any]) -> bool:
    """Kirim order ke MT5 via order_send(). Update Trade row bila sukses."""
    symbol = trade.get("symbol")
    side = trade.get("side", "BUY").upper()
    lot = float(trade.get("lotSize", 0.01))
    sl = trade.get("stopLoss")
    tp = trade.get("takeProfit")
    dashboard_ticket = trade.get("ticket")

    if side not in SIDE_TO_MT5:
        log.error(f"Side tidak dikenal: {side}")
        return False
    if not mt5.symbol_select(symbol, True):
        log.error(f"symbol_select({symbol}) gagal. Pair mungkin tidak ada di akun.")
        return False
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        log.error(f"symbol_info_tick({symbol}) None.")
        return False

    price = tick.ask if side == "BUY" else tick.bid
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": float(lot),
        "type": SIDE_TO_MT5[side],
        "price": float(price),
        "sl": float(sl) if sl else 0.0,
        "tp": float(tp) if tp else 0.0,
        "deviation": 20,                       # toleransi slippage (point)
        "magic": MAGIC_NUMBER,                 # tandai posisi milik bridge
        "comment": f"frxai:{dashboard_ticket}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    if result is None:
        log.error(f"order_send() None: {mt5.last_error()}")
        return False
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        log.error(f"Order ditolak MT5: retcode={result.retcode} "
                  f"comment={result.comment} (dashboard={dashboard_ticket})")
        synced_tickets.add(dashboard_ticket)  # jangan retry terus
        return False

    log.info(f"Order terkirim: {side} {symbol} {lot} lot @ {result.price} "
             f"ticket={result.order} (dashboard={dashboard_ticket})")
    update_trade_ticket(dashboard_ticket, int(result.order), float(result.price))
    synced_tickets.add(str(result.order))
    return True


def check_closed_positions() -> None:
    """Deteksi posisi yang hilang dari MT5 (ditutup via SL/TP/manual di terminal).
    Tandai Trade terkait sebagai CLOSED."""
    positions = mt5.positions_get() or []
    open_mt5_tickets = {p.ticket for p in positions}
    with db() as c:
        rows = c.execute(
            "SELECT ticket, symbol, side, lotSize, openPrice FROM Trade WHERE status='OPEN'"
        ).fetchall()
    for r in rows:
        if not str(r["ticket"]).isdigit():
            continue  # belum pernah sukses dikirim ke MT5
        mt5_ticket = int(r["ticket"])
        if mt5_ticket in open_mt5_tickets:
            continue
        # Posisi hilang dari MT5 -> dianggap closed. Ambil harga close dari history.
        close_price, pnl = float(r["openPrice"]), 0.0
        deals = mt5.history_deals_get(0, datetime.now(timezone.utc).timestamp()) or []
        for d in deals:
            if d.position_id == mt5_ticket and d.entry == mt5.DEAL_ENTRY_OUT:
                close_price, pnl = float(d.price), float(d.profit)
                break
        mark_trade_closed(mt5_ticket, close_price, pnl)
        log.info(f"Posisi tertutup di MT5: ticket={mt5_ticket} {r['side']} "
                 f"{r['symbol']} @ {close_price} PnL={pnl}")


# --------------------------- Publish real ticks ----------------------------
PUBLISHED_PAIRS = ["EURUSD", "USDJPY", "GBPUSD", "XAUUSD"]


def publish_ticks() -> None:
    """Baca tick real dari MT5 untuk setiap pair, POST ke dashboard.
    Dashboard menyimpan di market-cache; /api/market prefer real ticks."""
    quotes = []
    for sym in PUBLISHED_PAIRS:
        if not mt5.symbol_select(sym, True):
            continue
        tick = mt5.symbol_info_tick(sym)
        if tick is None:
            continue
        info = mt5.symbol_info(sym)
        digits = info.digits if info else 5
        # hitung spread dalam pips (approx)
        pip_size = 0.01 if sym in ("USDJPY",) else (0.1 if sym == "XAUUSD" else 0.0001)
        spread_pips = (tick.ask - tick.bid) / pip_size if pip_size else 0.0
        quotes.append({
            "symbol": sym,
            "bid": float(tick.bid),
            "ask": float(tick.ask),
            "spreadPips": round(spread_pips, 2),
            "changePct": 0.0,
            "last": float(tick.last) if tick.last else float((tick.bid + tick.ask) / 2),
            "high": float(tick.last) if tick.last else float(tick.ask),
            "low": float(tick.last) if tick.last else float(tick.bid),
            "ts": int(tick.time_msc) if hasattr(tick, "time_msc") else int(time.time() * 1000),
        })
    if quotes:
        api_post("/api/market/ticks", {"quotes": quotes})


# ------------------------------- Loop utama --------------------------------
def main_loop() -> None:
    global terminal_pid
    creds = load_credentials()
    log.info(f"Bridge start: akun={creds.get('mt5Account')} server={creds.get('mt5Server')} "
             f"terminal={creds.get('mt5TerminalPath')}")

    # 1) Launch terminal bila auto-start aktif dan belum running.
    if creds.get("mt5AutoStartTerminal") and not creds.get("mt5TerminalRunning"):
        path = creds.get("mt5TerminalPath")
        if path:
            log.info(f"Auto-start terminal: warmup {TERMINAL_WARMUP_SEC}s...")
            terminal_pid = launch_terminal(path)
            time.sleep(TERMINAL_WARMUP_SEC)
            api_post("/api/mt5/start-terminal", {})  # tandai running di dashboard
        else:
            log.warning("Auto-start ON tapi mt5TerminalPath kosong. Lewati launch.")

    # 2) initialize + login.
    if not connect_mt5(creds):
        log.error("Bridge gagal connect MT5. Cek kredensial / terminal. Exit.")
        return

    # 3) Loop polling.
    log.info(f"Loop polling aktif (interval {POLL_INTERVAL}s). Ctrl+C untuk stop.")
    while running:
        try:
            ts = api_get("/api/mt5/terminal-status")
            if ts and not ts.get("running", True):
                log.info("Dashboard minta stop terminal. Shutdown bridge.")
                break
            publish_ticks()                        # publish tick real ke dashboard
            sync_account_state()
            for trade in fetch_pending_orders():  # eksekusi order baru
                send_order_to_mt5(trade)
            check_closed_positions()              # sinkron posisi tertutup
        except Exception as e:
            log.exception(f"Error di loop utama: {e}")
        time.sleep(POLL_INTERVAL)

    # 4) Shutdown.
    log.info("Bridge shutting down...")
    try:
        mt5.shutdown()
        log.info("MT5 shutdown OK.")
    except Exception as e:
        log.warning(f"mt5.shutdown() error: {e}")
    if terminal_pid:
        kill_terminal(terminal_pid)
    write_account_state(0, 0, 0, 0, 0, terminal_running=False, terminal_pid_val=None)
    log.info("Bridge berhenti.")


def handle_signal(signum, frame):
    global running
    log.info(f"Sinyal {signum} diterima. Set running=False.")
    running = False


if __name__ == "__main__":
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGBREAK, handle_signal)  # Ctrl+Break di Windows
    main_loop()
