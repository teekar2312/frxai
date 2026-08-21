'use client';

export type Locale = 'id' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  id: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.charts': 'Grafik',
    'nav.aiAnalysis': 'Analisis AI',
    'nav.tradingSignals': 'Sinyal Trading',
    'nav.liveTrading': 'Trading Langsung',
    'nav.pendingOrders': 'Pesanan Tertunda',
    'nav.riskManagement': 'Manajemen Risiko',
    'nav.priceAlerts': 'Peringatan Harga',
    'nav.economicCalendar': 'Kalender Ekonomi',
    'nav.analytics': 'Analitik',
    'nav.backtesting': 'Backtesting',
    'nav.correlation': 'Korelasi',
    'nav.watchlist': 'Daftar Pantauan',
    'nav.community': 'Komunitas',
    'nav.activityLog': 'Log Aktivitas',
    'nav.settings': 'Pengaturan',
    // Status bar
    'status.connected': 'Terhubung',
    'status.disconnected': 'Terputus',
    'status.autoOn': 'Auto: AKTIF',
    'status.autoOff': 'Auto: NONAKTIF',
    'status.mt5Live': 'MT5 LIVE',
    'status.mt5Standby': 'MT5 ...',
    // Risk disclosure
    'risk.banner': '⚠️ Perdagangan berjangka memiliki risiko tinggi. Anda dapat mengalami kerugian melebihi investasi awal. Pastikan Anda memahami risiko sebelum bertransaksi.',
    'risk.simulation': 'MODE SIMULASI — Harga dan data bukan data pasar nyata. Untuk data live, konfigurasi FINNHUB_API_KEY.',
    'risk.mt5Fallback': '⚠️ Sumber harga MT5 tidak tersedia, menggunakan data cadangan',
    // Footer
    'footer.regulated': 'Diawasi BAPPEBTI',
    'footer.segregated': 'Dana klien disegregasi',
    'footer.disclaimer': 'Dana klien disimpan terpisah pada bank penampung yang diawasi BAPPEBTI',
    // Common
    'common.balance': 'Saldo',
    'common.dailyPnl': 'P&L Harian',
    'common.openPositions': 'Posisi Terbuka',
    'common.buy': 'BELI',
    'common.sell': 'JUAL',
    'common.close': 'Tutup',
    'common.cancel': 'Batal',
    'common.save': 'Simpan',
    'common.delete': 'Hapus',
    'common.loading': 'Memuat...',
    'common.noData': 'Tidak ada data',
    'common.error': 'Terjadi kesalahan',
    'common.success': 'Berhasil',
    'common.confirm': 'Konfirmasi',
    // Trading
    'trading.lotSize': 'Ukuran Lot',
    'trading.stopLoss': 'Stop Loss',
    'trading.takeProfit': 'Take Profit',
    'trading.entryPrice': 'Harga Masuk',
    'trading.direction': 'Arah',
    'trading.pair': 'Pasangan',
    'trading.pnl': 'P&L',
    'trading.pips': 'Pips',
    'trading.strategy': 'Strategi',
    'trading.confidence': 'Keyakinan',
    'trading.riskLevel': 'Tingkat Risiko',
    // Risk AI
    'risk.ai.highRisk': '⚠️ AI menilai risiko tinggi — pertimbangkan untuk mengurangi ukuran posisi',
    'risk.ai.mediumRisk': 'ℹ️ AI menilai risiko sedang — gunakan manajemen risiko ketat',
    'risk.ai.lowConfidence': '⛔ AI confidence terlalu rendah untuk trading otomatis (< 60%)',
    // Dashboard
    'dashboard.welcome': 'Selamat Datang di FINEX Indonesia',
    'dashboard.totalPnl': 'Total P&L',
    'dashboard.bestPair': 'Pair Terbaik',
    'dashboard.worstPair': 'Pair Terburuk',
    // Live Trading
    'trading.openPosition': 'Buka Posisi',
    'trading.closePosition': 'Tutup Posisi',
    'trading.confirmClose': 'Konfirmasi penutupan posisi?',
    'trading.positionOpened': 'Posisi berhasil dibuka',
    'trading.positionClosed': 'Posisi berhasil ditutup',
    // Risk Management
    'risk.calculator': 'Kalkulator Risiko',
    'risk.riskAmount': 'Jumlah Risiko',
    'risk.suggestedLot': 'Lot yang Disarankan',
    'risk.riskReward': 'Rasio Risiko/Imbalan',
    'risk.dailyLimit': 'Batas Risiko Harian',
    // Signals
    'signals.noSignals': 'Tidak ada sinyal',
    'signals.confidence': 'Keyakinan AI',
    'signals.strategy': 'Strategi',
    // Settings
    'settings.general': 'Umum',
    'settings.aiConfig': 'Konfigurasi AI',
    'settings.security': 'Keamanan',
    'settings.notifications': 'Notifikasi',
    'settings.language': 'Bahasa',
    'settings.saved': 'Pengaturan tersimpan',
    // Alerts
    'alerts.create': 'Buat Peringatan',
    'alerts.above': 'Di Atas',
    'alerts.below': 'Di Bawah',
    'alerts.triggered': 'Peringatan Tereksekusi',
    // Position statuses
    'status.open': 'Terbuka',
    'status.closed': 'Tertutup',
    'status.pending': 'Tertunda',
    'status.executed': 'Tereksekusi',
    'status.expired': 'Kedaluwarsa',
    // Timeframes
    'tf.M1': '1 Menit',
    'tf.M5': '5 Menit',
    'tf.M15': '15 Menit',
    'tf.M30': '30 Menit',
    'tf.H1': '1 Jam',
    'tf.H4': '4 Jam',
    'tf.D1': 'Harian',
    'tf.W1': 'Mingguan',
    // Sessions
    'session.Sydney': 'Sidney',
    'session.Tokyo': 'Tokyo',
    'session.London': 'London',
    'session.NewYork': 'New York',
    'session.all': 'Semua Sesi',
    // Admin
    'admin.userManagement': 'Manajemen Pengguna',
    'admin.systemConfig': 'Konfigurasi Sistem',
    'admin.auditLog': 'Log Audit Sistem',
  },
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.charts': 'Charts',
    'nav.aiAnalysis': 'AI Analysis',
    'nav.tradingSignals': 'Trading Signals',
    'nav.liveTrading': 'Live Trading',
    'nav.pendingOrders': 'Pending Orders',
    'nav.riskManagement': 'Risk Management',
    'nav.priceAlerts': 'Price Alerts',
    'nav.economicCalendar': 'Economic Calendar',
    'nav.analytics': 'Analytics',
    'nav.backtesting': 'Backtesting',
    'nav.correlation': 'Correlation',
    'nav.watchlist': 'Watchlist',
    'nav.community': 'Community',
    'nav.activityLog': 'Activity Log',
    'nav.settings': 'Settings',
    // Status bar
    'status.connected': 'Connected',
    'status.disconnected': 'Disconnected',
    'status.autoOn': 'Auto: ON',
    'status.autoOff': 'Auto: OFF',
    'status.mt5Live': 'MT5 LIVE',
    'status.mt5Standby': 'MT5 ...',
    // Risk disclosure
    'risk.banner': '⚠️ Futures trading involves high risk. You may lose more than your initial investment. Ensure you understand the risks before trading.',
    'risk.simulation': 'SIMULATION MODE — Prices and data are not real market data. For live data, configure FINNHUB_API_KEY.',
    'risk.mt5Fallback': '⚠️ MT5 price source unavailable, using backup data',
    // Footer
    'footer.regulated': 'Regulated by BAPPEBTI',
    'footer.segregated': 'Client funds segregated',
    'footer.disclaimer': 'Client funds are held separately in BAPPEBTI-supervised custodian banks',
    // Common
    'common.balance': 'Balance',
    'common.dailyPnl': 'Daily P&L',
    'common.openPositions': 'Open Positions',
    'common.buy': 'BUY',
    'common.sell': 'SELL',
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.loading': 'Loading...',
    'common.noData': 'No data',
    'common.error': 'An error occurred',
    'common.success': 'Success',
    'common.confirm': 'Confirm',
    // Trading
    'trading.lotSize': 'Lot Size',
    'trading.stopLoss': 'Stop Loss',
    'trading.takeProfit': 'Take Profit',
    'trading.entryPrice': 'Entry Price',
    'trading.direction': 'Direction',
    'trading.pair': 'Pair',
    'trading.pnl': 'P&L',
    'trading.pips': 'Pips',
    'trading.strategy': 'Strategy',
    'trading.confidence': 'Confidence',
    'trading.riskLevel': 'Risk Level',
    // Risk AI
    'risk.ai.highRisk': '⚠️ AI assesses high risk — consider reducing position size',
    'risk.ai.mediumRisk': 'ℹ️ AI assesses medium risk — use strict risk management',
    'risk.ai.lowConfidence': '⛔ AI confidence too low for auto-trading (< 60%)',
    // Dashboard
    'dashboard.welcome': 'Welcome to FINEX Indonesia',
    'dashboard.totalPnl': 'Total P&L',
    'dashboard.bestPair': 'Best Pair',
    'dashboard.worstPair': 'Worst Pair',
    // Live Trading
    'trading.openPosition': 'Open Position',
    'trading.closePosition': 'Close Position',
    'trading.confirmClose': 'Confirm position close?',
    'trading.positionOpened': 'Position opened successfully',
    'trading.positionClosed': 'Position closed successfully',
    // Risk Management
    'risk.calculator': 'Risk Calculator',
    'risk.riskAmount': 'Risk Amount',
    'risk.suggestedLot': 'Suggested Lot Size',
    'risk.riskReward': 'Risk/Reward Ratio',
    'risk.dailyLimit': 'Daily Risk Limit',
    // Signals
    'signals.noSignals': 'No signals available',
    'signals.confidence': 'AI Confidence',
    'signals.strategy': 'Strategy',
    // Settings
    'settings.general': 'General',
    'settings.aiConfig': 'AI Configuration',
    'settings.security': 'Security',
    'settings.notifications': 'Notifications',
    'settings.language': 'Language',
    'settings.saved': 'Settings saved',
    // Alerts
    'alerts.create': 'Create Alert',
    'alerts.above': 'Above',
    'alerts.below': 'Below',
    'alerts.triggered': 'Alert Triggered',
    // Position statuses
    'status.open': 'Open',
    'status.closed': 'Closed',
    'status.pending': 'Pending',
    'status.executed': 'Executed',
    'status.expired': 'Expired',
    // Timeframes
    'tf.M1': '1 Minute',
    'tf.M5': '5 Minutes',
    'tf.M15': '15 Minutes',
    'tf.M30': '30 Minutes',
    'tf.H1': '1 Hour',
    'tf.H4': '4 Hours',
    'tf.D1': 'Daily',
    'tf.W1': 'Weekly',
    // Sessions
    'session.Sydney': 'Sydney',
    'session.Tokyo': 'Tokyo',
    'session.London': 'London',
    'session.NewYork': 'New York',
    'session.all': 'All Sessions',
    // Admin
    'admin.userManagement': 'User Management',
    'admin.systemConfig': 'System Configuration',
    'admin.auditLog': 'System Audit Log',
  },
};

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'id';
  const stored = localStorage.getItem('finex-locale');
  if (stored === 'en' || stored === 'id') return stored;
  const browserLangs = navigator.languages || [navigator.language];
  if (browserLangs.some(l => l.startsWith('id'))) return 'id';
  return 'en';
}

let currentLocale: Locale = 'id';

export function setLocale(locale: Locale) {
  currentLocale = locale;
  if (typeof window !== 'undefined') localStorage.setItem('finex-locale', locale);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function initI18n() {
  currentLocale = detectLocale();
}

export function t(key: string, params?: Record<string, string | number>): string {
  let text = translations[currentLocale]?.[key] || translations['en']?.[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

// Export translations for the settings locale selector
export const LOCALE_LABELS: Record<Locale, string> = {
  id: '🇮🇩 Bahasa Indonesia',
  en: '🇬🇧 English',
};

// IDR/USD exchange rate
export const IDR_USD_RATE = 15850;

export function formatCurrency(amount: number, currency: 'USD' | 'IDR' = 'USD'): string {
  if (currency === 'IDR') {
    const idr = amount * IDR_USD_RATE;
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(idr);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Call init on module load (client-side only)
if (typeof window !== 'undefined') {
  initI18n();
}
