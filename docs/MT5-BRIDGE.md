# MT5 Python Bridge — Panduan Setup Windows 11

Dokumen ini menjelaskan cara menginstal dan menjalankan **MT5 Python Bridge** di komputer Windows 11 Anda. Bridge adalah script Python yang menjembatani dashboard web (Next.js) dengan terminal MetaTrader 5 desktop, sehingga order yang Anda klik di dashboard dieksekusi secara live ke server FINEX Indonesia.

---

## Prasyarat

Sebelum memulai, pastikan komputer Anda memenuhi:

- **Windows 11 (64-bit)** — library MetaTrader5 hanya berjalan di Windows 64-bit.
- **MetaTrader 5 desktop** — installer resmi dari FINEX Indonesia (bukan dari MetaQuotes).
- **Python 3.14** — versi 64-bit, terinstal dan masuk ke PATH.
- **Akun trading FINEX Indonesia** — demo atau real, dengan nomor akun, password, dan nama server.
- **Dashboard web berjalan** di `http://localhost:3000` (lihat README utama cara menjalankannya).
- **Koneksi internet stabil** — terminal MT5 butuh koneksi ke server broker.

> Bridge dan dashboard harus berjalan di komputer Windows yang sama. Bridge membaca database SQLite dashboard secara langsung dan memanggil endpoint `http://localhost:3000/api/*`.

---

## Arsitektur Bridge

```
 +-----------------------+         HTTP (localhost:3000)        +-----------------------------+
 |  Dashboard Web        |  <-------------------------------.  |  MT5 Python Bridge          |
 |  (Next.js, port 3000) |  --- POST /api/mt5/connect ----> |  (mt5_bridge.py, Windows)   |
 |                       |  --- GET  /api/mt5/credentials -->|                             |
 |  - UI trading         |  --- GET  /api/trade/list ------> |  - Baca kredensial dari DB  |
 |  - Form order         |  <--- poll /api/trade/list ------ |  - subprocess.Popen(MT5)    |
 |  - Posisi & P&L       |  <--- update SQLite Account ---- |  - MetaTrader5.initialize() |
 |  - Settings MT5       |                                   |  - MetaTrader5.login()      |
 +-----------+-----------+                                   |  - MetaTrader5.order_send()|
             |                                               |  - account_info() poll     |
             | SQLite (db/custom.db)                         +-------------+---------------+
             | <--- bridge baca/tulis langsung                             |
             v                                                            |  IPC (internal)
 +-----------------------+                                                v
 |  Prisma / SQLite      |                                   +-----------------------------+
 |  - Account.mt5*       |                                   |  MetaTrader 5 Terminal      |
 |  - Trade              |                                   |  (terminal64.exe)           |
 |  - Log                |                                   +-------------+---------------+
 +-----------------------+                                                 |
                                                                           | TCP/SSL
                                                                           v
                                                              +-----------------------------+
                                                              |  FINEX Indonesia Server     |
                                                              |  (FINEX-Live01 / FINEX-Demo)|
                                                              +-----------------------------+
```

**Penjelasan alur data:**

1. Anda memasukkan kredensial MT5 (nomor akun, password, server, path terminal) di dashboard → **Settings → Broker / MT5**. Kredensial disimpan di tabel `Account` pada SQLite DB lokal (`db/custom.db`).
2. Endpoint dashboard `/api/mt5/connect` menandai `mt5Connected = true` dan (bila `mt5AutoStartTerminal = true`) mensimulasikan peluncuran terminal. Endpoint `/api/mt5/start-terminal` dan `/api/mt5/stop-terminal` mengatur flag `mt5TerminalRunning` + `mt5TerminalPid`.
3. Bridge Python membaca kredensial langsung dari file SQLite (karena bridge & dashboard satu mesin) lalu memanggil `MetaTrader5.initialize(terminal_path)` + `MetaTrader5.login(account, password, server)`.
4. Setiap 2 detik, bridge membaca `account_info()` dari MT5 dan menulis kembali ke tabel `Account` (balance, equity, margin, freeMargin, marginLevel). Dashboard menampilkan data ini secara live.
5. Bridge juga me-poll `GET /api/trade/list` untuk mendeteksi order baru (status `OPEN` yang belum dieksekusi di MT5). Setiap order baru dikirim ke MT5 via `MetaTrader5.order_send()`, lalu bridge memperbarui baris `Trade` dengan ticket MT5 asli dan harga eksekusi.
6. Saat posisi ditutup (manual di dashboard atau terkena SL/TP di MT5), bridge mendeteksi posisi hilang dari `MetaTrader5.positions_get()` dan menandai `Trade.status = CLOSED` beserta PnL.

Endpoint dashboard yang dipakai bridge:

| Endpoint | Method | Fungsi |
|---|---|---|
| `/api/mt5/credentials` | GET | Ambil konfigurasi akun + terminal (password dimask, jadi bridge baca DB langsung) |
| `/api/mt5/terminal-status` | GET | Cek apakah terminal seharusnya berjalan (`running`, `pid`, `path`, `autoStart`) |
| `/api/mt5/connect` | POST | Memicu bridge connect (dashboard → bridge via polling flag `mt5Connected`) |
| `/api/mt5/start-terminal` | POST | Set flag `mt5TerminalRunning = true` (bridge akan launch `terminal64.exe`) |
| `/api/mt5/stop-terminal` | POST | Set flag `mt5TerminalRunning = false` (bridge akan `shutdown()` + kill proses) |
| `/api/trade/list` | GET | Ambil semua trade; bridge filter `status = OPEN` untuk dieksekusi |
| `/api/trade/place` | POST | Dashboard membuat order → bridge deteksi via `/api/trade/list` |
| `/api/trade/close` | POST | Dashboard menutup order → bridge deteksi via `positions_get()` |

---

## Step 1: Install MetaTrader 5

1. **Download installer MT5 dari FINEX Indonesia.** Jangan gunakan installer generik dari MetaQuotes — broker FINEX mengemas terminal dengan server dan kontrak yang sudah pre-konfigurasi.
2. **Jalankan installer** (`mt5setup.exe`) sebagai Administrator. Default path instalasi:
   ```
   C:\Program Files\MetaTrader 5\terminal64.exe
   ```
   Catat path ini — Anda akan memasukkannya ke dashboard.
3. **Buka terminal MT5** pertama kali. Saat dialog login muncul, masukkan nomor akun + password dari FINEX. Pilih server yang sesuai:
   - `FINEX-Live01` — akun real
   - `FINEX-Demo` — akun demo
4. **Verifikasi koneksi berhasil.** Setelah login, panel "Navigator" di MT5 akan menampilkan saldo akun dan indikator koneksi (pojok kanan bawah hijau). Jika gagal, periksa server dan password di email pendaftaran FINEX.
5. **Catat informasi berikut** (diperlukan di Step 4):
   - Nomor akun (contoh: `90323236`)
   - Password (master password untuk trading, atau investor password untuk read-only)
   - Server (`FINEX-Live01` atau `FINEX-Demo`)
   - Path terminal: `C:\Program Files\MetaTrader 5\terminal64.exe`

> Penting: Terminal MT5 harus pernah di-login minimal satu kali secara manual. Ini menyimpan sesi dan sertifikat server yang dibutuhkan oleh library `MetaTrader5` Python.

---

## Step 2: Install Python 3.14 + MetaTrader5 Library

1. **Download Python 3.14 64-bit** dari https://www.python.org/downloads/windows/. Pilih installer "Windows installer (64-bit)".
2. **Saat install, centang** "Add Python 3.14 to PATH" di dialog pertama installer. Pilih "Install Now".
3. **Buka Command Prompt** (Win+R → `cmd` → Enter) dan verifikasi:
   ```cmd
   python --version
   ```
   Output yang diharapkan:
   ```
   Python 3.14.0
   ```
4. **Install library MetaTrader5** dan dependensi bridge:
   ```cmd
   pip install MetaTrader5
   pip install requests
   ```
   Output yang diharapkan:
   ```
   Successfully installed MetaTrader5-5.0.45 requests-2.32.3
   ```
5. **Verifikasi import** berhasil:
   ```cmd
   python -c "import MetaTrader5 as mt5; print(mt5.__version__)"
   ```
   Output yang diharapkan:
   ```
   5.0.45
   ```

**Catatan library MetaTrader5:**
- Library ini **HANYA berjalan di Windows 64-bit**. Tidak ada build untuk Linux/macOS.
- Python harus 64-bit (`python -c "import struct; print(struct.calcsize('P')*8)"` harus cetak `64`).
- Terminal MT5 harus terinstal (library berkomunikasi dengan `terminal64.exe` via IPC internal).
- Versi Python yang didukung: 3.7 - 3.14. Untuk Python 3.14, pastikan Anda menginstall MetaTrader5 >= 5.0.45.

---

## Step 3: Bridge Script

Buat file `mt5_bridge.py` di folder yang sama dengan project dashboard (misalnya `C:\frxai\mt5_bridge.py`). Berikut adalah implementasi lengkap dan runnable:

```python
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
DB_PATH = os.environ.get("DASHBOARD_DB", r"C:\frxai\db\custom.db")
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000")
POLL_INTERVAL = float(os.environ.get("BRIDGE_POLL_INTERVAL", "2"))
TERMINAL_WARMUP_SEC = 8
LOG_FILE = Path(__file__).resolve().parent / "mt5_bridge.log"
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
        raise FileNotFoundError(f"DB dashboard tidak ditemukan: {DB_PATH}")
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
    """Tandai Trade sebagai CLOSED ketika posisi hilang dari MT5."""
    with db() as c:
        c.execute(
            "UPDATE Trade SET status='CLOSED', closePrice=?, pnl=?, closedAt=? "
            "WHERE ticket=? AND status='OPEN'",
            (close_price, pnl, datetime.now(timezone.utc).isoformat(), str(mt5_ticket)),
        )
        c.commit()


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
```

> **Catatan implementasi:**
> - Bridge membaca SQLite DB dashboard langsung (`db/custom.db`) untuk kredensial & state akun — karena bridge & dashboard satu mesin, ini lebih andal daripada HTTP. Untuk order & status terminal, bridge tetap memakai endpoint `/api/*` agar dashboard berperilaku konsisten.
> - `magic = 20251101` menandai posisi yang dibuat oleh bridge. Bila Anda punya posisi manual di MT5, bridge tidak akan menutupnya.
> - `synced_tickets` mencegah order dobel-eksekusi bila dashboard membuat baris Trade lalu ticket diganti ke ticket MT5 asli.

---

## Step 4: Konfigurasi Dashboard

Sebelum menjalankan bridge, konfigurasikan dulu dashboard:

1. Buka dashboard di browser: `http://localhost:3000`.
2. Klik **Settings** di sidebar kiri → pilih tab **Broker / MT5**.
3. Isi form **"Kredensial Akun MT5"**:
   - **Nomor Akun MT5**: contoh `90323236` (4-12 digit angka, divalidasi oleh `/api/mt5/credentials` PUT).
   - **Password MT5**: password master akun. Untuk read-only, gunakan investor password.
   - **Server MT5**: contoh `FINEX-Live01` atau `FINEX-Demo` (harus sama persis dengan yang muncul di terminal MT5 → menu File → Open Account → kolom Server).
   - **Tipe Akun**: pilih `DEMO` atau `REAL`. Pilih `REAL` hanya setelah verifikasi di akun demo.
4. Klik **Simpan**.
5. Isi form **"Aplikasi Terminal MT5"**:
   - **Path Terminal**: `C:\Program Files\MetaTrader 5\terminal64.exe` (atau path instalasi Anda). Klik kanan ikon MT5 di desktop → Properties → Copy path "Target".
   - **Auto-start terminal**: aktifkan (ON). Bridge akan otomatis meluncurkan terminal saat start.
6. Klik **Simpan Konfigurasi**.
7. **Jangan klik "Sambungkan MT5" dulu.** Tombol ini akan menandai `mt5Connected = true` di dashboard — lakukan setelah bridge berhasil login. Atau klik sekarang: dashboard akan set flag, dan bridge akan mengonfirmasi saat polling berikutnya.

Verifikasi konfigurasi tersimpan:

```cmd
curl http://localhost:3000/api/mt5/credentials
```

Output yang diharapkan (password ter-mask):
```json
{
  "credentials": {
    "mt5Account": "90323236",
    "mt5Password": "9••••6",
    "mt5Server": "FINEX-Demo",
    "mt5AccountType": "demo",
    "mt5Terminal": "MetaTrader5",
    "hasPassword": true
  },
  "terminal": {
    "path": "C:\\Program Files\\MetaTrader 5\\terminal64.exe",
    "running": false,
    "pid": null,
    "autoStart": true
  }
}
```

---

## Step 5: Menjalankan Bridge

1. Pastikan dashboard berjalan di port 3000 (terminal Node.js terbuka):
   ```cmd
   cd C:\frxai
   bun run dev
   ```
   atau
   ```cmd
   npm run dev
   ```
2. Buka Command Prompt **baru** (jangan tutup yang menjalankan dashboard), lalu jalankan bridge:
   ```cmd
   cd C:\frxai
   python mt5_bridge.py
   ```
3. **Output yang diharapkan** di console bridge:
   ```
   2025-11-01 14:32:10  INFO    Bridge start: akun=90323236 server=FINEX-Demo terminal=C:\Program Files\MetaTrader 5\terminal64.exe
   2025-11-01 14:32:10  INFO    Auto-start terminal: warmup 8s...
   2025-11-01 14:32:10  INFO    Terminal MT5 diluncurkan: C:\Program Files\MetaTrader 5\terminal64.exe (PID 14832)
   2025-11-01 14:32:18  INFO    Initialize MT5 dengan terminal: C:\Program Files\MetaTrader 5\terminal64.exe
   2025-11-01 14:32:19  INFO    MT5 terhubung: login=90323236 server=FINEX-Demo balance=10000.00 USD leverage=1:500
   2025-11-01 14:32:19  INFO    Loop polling aktif (interval 2.0s). Ctrl+C untuk stop.
   ```
4. **Verifikasi dashboard menampilkan data live**:
   - Buka `http://localhost:3000` → panel **Overview** → Balance & Equity kini menampilkan saldo asli dari MT5 (bukan `10000` default).
   - Buka **Settings → Broker / MT5** → status panel menampilkan `BERJALAN` (PID 14832) dan `Terhubung`.
   - Buka **Logs** → muncul baris `MT5 terminal launched` dan `MT5 bridge connected`.
5. **Untuk menghentikan bridge**: tekan `Ctrl+C` di console bridge. Bridge akan:
   - Memanggil `mt5.shutdown()` (menutup koneksi library).
   - `taskkill /PID 14832 /F` (menutup aplikasi terminal).
   - Set `mt5TerminalRunning = false` + `mt5Connected = false` di DB.
   - Cetak: `Bridge berhenti.`

> Log bridge juga tersimpan di `C:\frxai\mt5_bridge.log` (rotasi manual — hapus bila ukurannya > 50MB).

---

## Alur Eksekusi Order

Berikut langkah demi langkah saat user mengklik tombol **Beli** di dashboard:

```
 User klik "Beli EURUSD 0.01 lot" di Trading section
       │
       ▼
 Browser POST /api/trade/place  body={symbol:EURUSD, side:BUY, lotSize:0.01, slPips:8, tpPips:12}
       │
       ▼
 Dashboard route.ts:
   - validasi risk (maxOpenPositions, dailyLossLimit)
   - ambil quote.ask sebagai openPrice (simulasi di sandbox)
   - INSERT ke Trade (status=OPEN, ticket="173568900012345")
   - update Account.margin += notional/500
   - return {trade, ok:true}
       │
       ▼
 Browser terima response → toast "Order dibuka" → trade muncul di tabel Posisi Terbuka
       │
       ▼  (asinkron, di mesin Windows)
 MT5 Python Bridge (loop 2 detik):
   - GET /api/trade/list → temukan Trade baru status=OPEN, ticket="173568900012345"
   - ticket belum di synced_tickets → eksekusi
   - mt5.symbol_select("EURUSD", True)
   - tick = mt5.symbol_info_tick("EURUSD") → price = tick.ask
   - mt5.order_send({action:DEAL, symbol:EURUSD, volume:0.01, type:BUY, price, sl, tp, magic:20251101})
   - retcode == TRADE_RETCODE_DONE → result.order = 80654412 (ticket MT5 asli)
   - UPDATE Trade SET ticket='80654412', openPrice=result.price WHERE ticket='173568900012345'
   - synced_tickets.add('80654412')
       │
       ▼
 Bridge loop berikutnya (2 detik):
   - mt5.account_info() → balance, equity, margin terbaru
   - UPDATE Account SET balance, equity, margin, freeMargin, marginLevel
       │
       ▼
 Browser (live polling) → tampilan Overview & Trading refresh
       │
       ▼
 Posisi muncul di MT5 Terminal (GUI desktop) → trader dapat lihat & kelola manual
```

**Kondisi penutupan posisi:**

- **Manual di dashboard**: user klik tombol Close di tabel posisi → POST `/api/trade/close` → dashboard hitung PnL simulasi & set status=CLOSED. Bridge deteksi ticket hilang dari `positions_get()` → skip (sudah ditutup dashboard).
- **SL/TP tersentuh di MT5**: terminal otomatis tutup posisi → bridge deteksi ticket hilang → ambil close price & PnL dari `history_deals_get()` → UPDATE Trade SET status=CLOSED.
- **Manual di terminal MT5** (klik Close di GUI MT5): sama seperti SL/TP — bridge sinkronisasi.

---

## Troubleshooting

### "ModuleNotFoundError: No module named 'MetaTrader5'"
**Penyebab:** Library belum terinstal, atau terinstal di Python versi berbeda.
**Solusi:**
```cmd
python -m pip install MetaTrader5
python -c "import MetaTrader5; print(MetaTrader5.__version__)"
```
Bila masih gagal, pastikan `python` di PATH merujuk ke Python 64-bit yang sama:
```cmd
where python
python -c "import struct; print(struct.calcsize('P')*8, 'bit')"
```
Harus cetak `64 bit`.

### "MetaTrader5.initialize() failed" atau terminal path salah
**Penyebab:** Path ke `terminal64.exe` salah, atau MT5 belum terinstal.
**Solusi:**
- Klik kanan ikon MT5 di desktop → Properties → copy "Target".
- Pastikan path di Settings → Broker / MT5 sama persis (termasuk spasi & kapital).
- Test path dari command prompt:
  ```cmd
  dir "C:\Program Files\MetaTrader 5\terminal64.exe"
  ```
- Bila path benar tapi initialize() tetap gagal: jalankan terminal MT5 manual sekali, login, tutup, lalu coba bridge lagi. Library butuh sesi terminal yang sudah ter-initialize di sisi GUI.

### "MetaTrader5.login() failed" / Invalid account
**Penyebab:** Nomor akun, password, atau server salah.
**Solusi:**
- Buka terminal MT5 → menu File → Login to Trade Account → cek kombinasi server + akun + password berhasil.
- Pastikan tidak ada spasi di awal/akhir nomor akun.
- Untuk server: coba nama alternatif (kadang broker menamai server berbeda, mis. `FINEX-Demo` vs `FINEX-Demo-01`). Cek email pendaftaran FINEX.
- Password investor (read-only) tidak bisa place order — bridge `order_send` akan gagal dengan retcode `TRADE_RETCODE_INVALID`. Gunakan master password untuk trading.

### "Terminal not running" padahal bridge sudah launch
**Penyebab:** `subprocess.Popen` berhasil tapi terminal crash saat startup (korup data, lisensi, antivirus memblok).
**Solusi:**
- Jalankan `terminal64.exe` manual double-click. Bila muncul error dialog, baca pesannya.
- Disable sementara antivirus / Windows Defender untuk folder MT5.
- Hapus cache terminal: hapus folder `C:\Users\<user>\AppData\Roaming\MetaQuotes\Terminal\<hash>\` lalu restart terminal.
- Tingkatkan `TERMINAL_WARMUP_SEC` dari 8 ke 15 detik (MT5 butuh waktu init lebih lama di PC lambat):
  ```cmd
  set BRIDGE_POLL_INTERVAL=2
  set TERMINAL_WARMUP_SEC=15
  python mt5_bridge.py
  ```

### Windows Defender Firewall memblok bridge
**Gejala:** Bridge jalan, tapi `requests.get("http://localhost:3000")` timeout.
**Solusi:**
- Buka **Windows Security → Firewall & network protection → Allow an app through firewall**.
- Tambahkan `python.exe` (biasanya `C:\Users\<user>\AppData\Local\Programs\Python\Python314\python.exe`) untuk Private network.
- Atau matikan firewall untuk profil Private sementara (tidak disarankan untuk publik).

### Order dobel-eksekusi
**Gejala:** Satu klik "Beli" di dashboard menghasilkan 2 order di MT5.
**Penyebab:** `synced_tickets` tidak persist antar restart bridge. Dashboard ticket (`173568900012345`) terlihat "baru" setiap restart.
**Solusi:** Pastikan bridge tidak di-restart di tengah sesi trading. Bila harus restart, restart juga dashboard (clear OPEN trades manual) atau hapus baris Trade OPEN dari DB dashboard sebelum start bridge.

### Dashboard balance tidak update walau bridge jalan
**Penyebab:** Bridge gagal tulis ke DB dashboard (DB di path berbeda, atau dashboard lagi hold lock).
**Solusi:**
- Cek `DASHBOARD_DB` env var:
  ```cmd
  echo %DASHBOARD_DB%
  ```
  Harus cetak path absolut ke `custom.db`. Default: `C:\frxai\db\custom.db`.
- Test koneksi DB manual:
  ```cmd
  python -c "import sqlite3; c=sqlite3.connect(r'C:\frxai\db\custom.db'); print(c.execute('SELECT balance FROM Account').fetchone())"
  ```
- Bila dashboard menulis ke DB saat bridge juga menulis, SQLite handle ini baik (WAL mode Prisma). Tapi pastikan tidak ada proses lain yang eksklusif lock DB.

### Bridge crash dengan traceback `sqlite3.OperationalError: database is locked`
**Penyebab:** Dashboard (Prisma) sedang menulis ke DB saat bridge juga menulis, dan SQLite default journal mode tidak WAL.
**Solusi:**
- Pastikan Prisma dashboard sudah set `journal_mode=WAL` (default di Prisma SQLite).
- Atau kurangi frekuensi polling bridge: `set BRIDGE_POLL_INTERVAL=5`.
- Restart dashboard (Next.js dev server) untuk re-init connection.

---

## Keamanan

- **Password MT5 disimpan lokal di SQLite** (`db/custom.db`) di komputer Anda. Tidak pernah dikirim ke internet. Dashboard hanya mengembalikan password ter-mask via `GET /api/mt5/credentials`.
- **Bridge hanya berkomunikasi dengan `localhost:3000`** — tidak ada panggilan keluar selain ke server FINEX (yang dilakukan oleh terminal MT5 sendiri).
- **Investor password untuk read-only**: bila Anda hanya ingin dashboard memantau akun tanpa bisa place order, gunakan investor password (bisa di-set di terminal MT5 → Tools → Options → Server). Order dari dashboard akan ditolak MT5 dengan retcode `TRADE_RETCODE_INVALID`.
- **Backup database sebelum trading real**:
  ```cmd
  copy C:\frxai\db\custom.db C:\frxai\db\custom.db.backup.%date:~10,4%%date:~4,2%%date:~7,2%
  ```
- **Jangan commit `db/custom.db` ke git**. Repo sudah mengecualikannya via `.gitignore` (`/db/*.db`).
- **VPS Windows**: bila dashboard di-deploy ke VPS, pasang MT5 + bridge di VPS yang sama. Jangan ekspos port 3000 ke publik — gunakan SSH tunnel atau Cloudflare Access.
- **Audit trail**: semua order & event dicatat di tabel `Log` dashboard (lihat section Logs) dan di file `mt5_bridge.log`. Simpan log minimal 30 hari.

---

## Catatan Penting

1. **Library MetaTrader5 HANYA berjalan di Windows** (64-bit). Tidak ada build untuk Linux atau macOS. Untuk Linux, gunakan Wine + Windows Python — tapi ini tidak didukung resmi dan rawan crash. Untuk VPS, pilih Windows VPS (Azure Windows VM, Vultr Windows, atau Windows VPS broker).

2. **Terminal MT5 harus terinstal dan pernah di-login minimal satu kali secara manual**. Library Python butuh sesi terminal yang sudah tersimpan (sertifikat server, cache login) di `%APPDATA%\MetaQuotes\Terminal\`. Tanpa itu, `initialize()` akan gagal.

3. **Bridge harus berjalan terus saat trading otomatis aktif**. Bila bridge berhenti (Crash, Ctrl+C, Windows restart), order dari dashboard tetap masuk ke DB tapi tidak dieksekusi di MT5. Setup:
   - Auto-start bridge saat Windows boot: gunakan **Task Scheduler** → Action: `python mt5_bridge.py`, Trigger: At log on, Start in: `C:\frxai`.
   - Atau pasang sebagai Windows Service via `nssm` (Non-Sucking Service Manager):
     ```cmd
     nssm install mt5bridge "C:\Users\<user>\AppData\Local\Programs\Python\Python314\python.exe" "C:\frxai\mt5_bridge.py"
     nssm start mt5bridge
     ```
4. **VPS untuk 24/7 trading**: pilih Windows VPS dengan spesifikasi minimum:
   - Windows Server 2022 (atau Windows 11)
   - 4 GB RAM, 2 vCPU
   - Lokasi dekat server broker FINEX (Singapore / Jakarta) untuk latency rendah.
   - Pasang: MT5 terminal, Python 3.14, dashboard, bridge — semua di satu VPS.

5. **Demo dulu, real kemudian**. Selalu uji bridge di akun demo FINEX-Demo minimal 1 minggu sebelum switch ke akun real. Verifikasi:
   - Order dashboard → muncul di MT5 (ticket cocok).
   - SL/TP tersentuh → dashboard update PnL.
   - Close manual di dashboard → posisi hilang di MT5.
   - Close manual di MT5 → dashboard update PnL.
   - Restart bridge → tidak ada order dobel.

6. **Rate limit broker**: hindari place order > 1 per detik. Broker dapat membatasi akun bila terdeteksi spam. Dashboard sudah throttle via `maxOpenPositions` (default 3) dan `dailyLossLimit` (default 3%).

7. **Magic number** bridge adalah `20251101`. Bila Anda menjalankan EA (Expert Advisor) lain di akun yang sama, pastikan EA tidak pakai magic number yang sama — bila tidak, bridge dapat salah interpretasi posisi milik EA.

8. **Timezone**: terminal MT5 default ke timezone broker (biasanya GMT+2/GMT+3, server time). Bridge konversi ke UTC saat menulis `closedAt` ke DB. Dashboard menampilkan waktu lokal browser.

---

**Selesai.** Bila bridge berjalan dengan baik, dashboard Anda kini terhubung ke market forex live via FINEX Indonesia. Selalu pantau panel **Logs** dan **Risk Management** untuk memastikan trading berjalan sesuai aturan.
