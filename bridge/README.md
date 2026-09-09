# MT5 Python Bridge

Script Python yang menjembatani dashboard web FXQuant AI dengan terminal MetaTrader 5 di Windows 11, untuk trading real akun FINEX Indonesia.

---

## Prasyarat

- **Windows 11** (64-bit) — library MetaTrader5 tidak jalan di Linux/macOS
- **Python 3.14** (64-bit) — verifikasi: `python -c "import struct; print(struct.calcsize('P')*8)"` harus cetak `64`
- **MetaTrader 5** desktop terinstall dari FINEX Indonesia
- **Dashboard FXQuant AI** berjalan di `http://localhost:3000`

## Instalasi

```cmd
:: 1. Install dependencies
cd C:\frxai
pip install -r bridge\requirements.txt

:: 2. Verifikasi MetaTrader5 terinstall
python -c "import MetaTrader5 as mt5; print(mt5.__version__)"
```

## Konfigurasi

Sebelum menjalankan bridge, konfigurasikan dashboard terlebih dahulu:

1. Buka dashboard di browser: `http://localhost:3000`
2. **Settings** → tab **Broker / MT5**
3. Isi form **Kredensial Akun MT5**:
   - Nomor Akun MT5 (4-12 digit)
   - Password MT5
   - Server MT5 (mis. `FINEX-Live01` atau `FINEX-Demo`)
   - Tipe Akun: DEMO atau REAL
4. Isi form **Aplikasi Terminal MT5**:
   - Path Terminal: `C:\Program Files\MetaTrader 5\terminal64.exe`
   - Auto-start terminal: ON
5. Klik **Simpan Konfigurasi**

Detail lengkap: [docs/MT5-BRIDGE.md](../docs/MT5-BRIDGE.md)

## Menjalankan Bridge

Pastikan dashboard berjalan di terminal pertama:
```cmd
cd C:\frxai
bun run dev
```

Buka Command Prompt **baru**, jalankan bridge:
```cmd
cd C:\frxai
python bridge\mt5_bridge.py
```

**Hentikan:** `Ctrl+C` (bridge akan shutdown MT5 dengan rapi)

## Environment Variables (opsional)

Bridge membaca environment variables berikut (defaultnya cocok untuk setup standar):

| Variable | Default | Deskripsi |
|---|---|---|
| `DASHBOARD_DB` | `C:\frxai\db\custom.db` | Path ke SQLite DB dashboard |
| `DASHBOARD_URL` | `http://localhost:3000` | URL dashboard web |
| `BRIDGE_POLL_INTERVAL` | `2` | Interval polling (detik) |

Contoh override:
```cmd
set DASHBOARD_DB=D:\frxai\db\custom.db
set DASHBOARD_URL=http://192.168.1.100:3000
python bridge\mt5_bridge.py
```

## Log

Bridge menulis log ke dua tempat:
- **Console** (stdout) — realtime
- **File** `bridge\mt5_bridge.log` — persistent

Contoh log sukses:
```
2025-11-01 14:32:10  INFO    Bridge start: akun=90323236 server=FINEX-Demo terminal=C:\Program Files\MetaTrader 5\terminal64.exe
2025-11-01 14:32:10  INFO    Auto-start terminal: warmup 8s...
2025-11-01 14:32:10  INFO    Terminal MT5 diluncurkan: C:\Program Files\MetaTrader 5\terminal64.exe (PID 14832)
2025-11-01 14:32:18  INFO    Initialize MT5 dengan terminal: C:\Program Files\MetaTrader 5\terminal64.exe
2025-11-01 14:32:19  INFO    MT5 terhubung: login=90323236 server=FINEX-Demo balance=10000.00 USD leverage=1:500
2025-11-01 14:32:19  INFO    Loop polling aktif (interval 2.0s). Ctrl+C untuk stop.
```

## Troubleshooting

Lihat [docs/MT5-BRIDGE.md → Troubleshooting](../docs/MT5-BRIDGE.md#troubleshooting) untuk solusi masalah umum:

- `ModuleNotFoundError: No module named 'MetaTrader5'` → install library
- `initialize() failed` → cek path terminal, pastikan MT5 terinstall
- `login() failed` → kredensial/server salah
- `symbol_select() gagal` → pair tidak tersedia di akun (aktifkan di Market Watch MT5)
- Firewall blocking → allow Python through Windows Defender Firewall

## Keamanan

- Password MT5 disimpan lokal di SQLite (`db/custom.db`) — tidak dikirim ke internet
- Bridge hanya berkomunikasi dengan `localhost:3000` (dashboard)
- Untuk akun real: pertimbangkan gunakan **investor password** (read-only) untuk monitoring
- Backup `db/custom.db` sebelum trading real
- `magic = 20251101` menandai posisi milik bridge — posisi manual di MT5 tidak akan ditutup bridge

## Cara Kerja

```
Dashboard (Next.js, port 3000)        Bridge (Python)          MetaTrader 5
        |                                 |                         |
        |  User klik "Beli EURUSD"        |                         |
        |  POST /api/trade/place          |                         |
        |  → Trade row (status=OPEN)      |                         |
        |                                 |                         |
        |  ← GET /api/trade/list (poll)   |                         |
        |    (kirim Trade OPEN)           |                         |
        |                                 |  mt5.order_send()       |
        |                                 |  → order terkirim       |
        |                                 |  ← result.order (ticket)|
        |  UPDATE Trade SET ticket=?      |                         |
        |    (ticket MT5 asli)            |                         |
        |                                 |                         |
        |  ← sync account_info() (poll)   |  mt5.account_info()     |
        |    UPDATE Account SET balance=? |                         |
```

## File

- `mt5_bridge.py` — script bridge utama (runnable)
- `requirements.txt` — dependencies Python
- `mt5_bridge.log` — file log (auto-generated, di-gitignore)
