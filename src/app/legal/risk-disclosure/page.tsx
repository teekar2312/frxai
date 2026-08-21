'use client';

import Link from 'next/link';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

export default function RiskDisclosurePage() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto w-full px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-600/10 border border-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Pernyataan Risiko</h1>
              <p className="text-xs text-zinc-500">Terakhir diperbarui: 1 Januari 2025</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
        <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <p className="text-sm text-amber-300 font-medium">
            ⚠️ Peringatan Penting: Perdagangan berjangka dan forex mengandung risiko tinggi. Anda dapat kehilangan seluruh modal Anda.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">1. Risiko Umum Trading Forex</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Perdagangan valuta asing (forex) melibatkan risiko yang signifikan dan tidak cocok untuk semua investor.
            Nilai tukar mata uang dapat berfluktuasi secara tajam akibat berbagai faktor termasuk kebijakan moneter,
            kondisi geopolitik, dan peristiwa ekonomi global.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Anda harus menyadari bahwa kerugian dapat melebihi deposit awal dan Anda mungkin diharuskan melakukan
            pembayaran tambahan. Pastikan Anda sepenuhnya memahami risiko sebelum memulai perdagangan.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">2. Risiko Leverage</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Leverage memungkinkan Anda untuk mengendalikan posisi yang lebih besar dari modal Anda. Namun, leverage
            juga memperbesar potensi kerugian secara proporsional. Dengan leverage 1:100, pergerakan pasar 1% dapat
            mengakibatkan keuntungan atau kerugian 100% dari margin Anda.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Margin call dan stop-out dapat terjadi ketika ekuitas akun turun di bawah tingkat tertentu, yang dapat
            mengakibatkan penutupan paksa posisi Anda dengan kerugian.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">3. Risiko Teknologi</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Perdagangan elektronik rentan terhadap gangguan teknis termasuk kegagalan perangkat keras dan perangkat
            lunak, gangguan koneksi internet, dan serangan siber. Meskipun kami menerapkan langkah-langkah keamanan,
            kerugian dapat terjadi akibat kegagalan sistem.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Sinyal dan analisis AI yang disediakan bersifat informatif dan dapat mengandung kesalahan. Keputusan
            trading harus didasarkan pada penilaian mandiri Anda.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">4. Risiko Likuiditas</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Likuiditas pasar dapat berubah secara signifikan, terutama di luar jam perdagangan utama atau selama
            peristiwa ekonomi besar. Kondisi likuiditas rendah dapat mengakibatkan slippage, di mana eksekusi order
            terjadi pada harga yang berbeda dari yang diharapkan.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Spread dapat melebar secara signifikan dalam kondisi volatilitas tinggi, meningkatkan biaya perdagangan.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">5. Pernyataan BAPPEBTI</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            FINEX Indonesia beroperasi sesuai dengan ketentuan yang ditetapkan oleh Badan Pengawas Perdagangan
            Berjangka Komoditi (BAPPEBTI). Sesuai Peraturan BAPPEBTI No. 5 Tahun 2019, setiap calon nasabah
            wajib memahami risiko perdagangan berjangka sebelum membuka rekening.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Perusahaan tidak menjamin keuntungan dari aktivitas perdagangan. Informasi dan analisis yang disediakan
            bukan merupakan jaminan atas hasil trading di masa depan.
          </p>
        </section>
      </main>

      <footer className="border-t border-zinc-800 py-6 mt-auto">
        <div className="max-w-4xl mx-auto w-full px-6 text-center">
          <p className="text-xs text-zinc-600">&copy; {new Date().getFullYear()} FINEX Indonesia. Seluruh hak cipta dilindungi.</p>
          <p className="text-xs text-zinc-700 mt-1">Terdaftar dan Diawasi oleh BAPPEBTI</p>
        </div>
      </footer>
    </div>
  );
}
