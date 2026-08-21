'use client';

import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto w-full px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Syarat & Ketentuan</h1>
              <p className="text-xs text-zinc-500">Terakhir diperbarui: 1 Januari 2025</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">1. Ketentuan Umum</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Syarat dan Ketentuan ini mengatur hubungan antara FINEX Indonesia (&quot;Perusahaan&quot;, &quot;kami&quot;) dan pengguna
            platform trading (&quot;Pengguna&quot;, &quot;Anda&quot;). Dengan mengakses dan menggunakan platform FINEX Indonesia,
            Anda dianggap telah membaca, memahami, dan menyetujui seluruh syarat dan ketentuan yang berlaku.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Perusahaan berhak untuk mengubah, memodifikasi, atau memperbarui Syarat dan Ketentuan ini sewaktu-waktu
            tanpa pemberitahuan terlebih dahulu. Perubahan akan berlaku efektif setelah dipublikasikan di platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">2. Penggunaan Platform</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Anda harus berusia minimal 18 tahun atau telah menikah untuk menggunakan platform ini. Anda wajib
            memberikan informasi yang benar dan akurat saat pendaftaran. Akun bersifat pribadi dan tidak boleh
            dialihkan kepada pihak lain tanpa persetujuan tertulis dari Perusahaan.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Pengguna dilarang menggunakan platform untuk kegiatan yang melanggar hukum, termasuk namun tidak terbatas
            pada pencucian uang, pendanaan teroris, dan manipulasi pasar. Pelanggaran akan mengakibatkan penutupan
            akun dan pelaporan kepada otoritas terkait.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">3. Risiko Perdagangan</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Perdagangan forex dan instrumen keuangan berjangka melibatkan risiko tinggi dan mungkin tidak sesuai
            untuk semua investor. Anda dapat mengalami kerugian yang melebihi investasi awal Anda. Pastikan Anda
            memahami risiko yang terlibat dan hanya menggunakan dana yang siap Anda risikokan.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Kinerja masa lalu bukan indikator hasil di masa depan. Sinyal dan analisis yang disediakan oleh platform
            bersifat informatif dan bukan merupakan rekomendasi investasi. Keputusan trading sepenuhnya menjadi
            tanggung jawab Pengguna.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">4. Batasan Tanggung Jawab</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Perusahaan tidak bertanggung jawab atas kerugian yang timbul akibat penggunaan platform, termasuk namun
            tidak terbatas pada kerugian akibat koneksi internet, gangguan teknis, atau keputusan trading berdasarkan
            informasi yang disediakan.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Total tanggung jawab Perusahaan tidak akan melebihi jumlah biaya yang Anda bayarkan kepada Perusahaan
            dalam 12 bulan terakhir. Perusahaan tidak memberikan jaminan atas keuntungan atau hasil trading tertentu.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">5. Hukum yang Berlaku</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Syarat dan Ketentuan ini diatur oleh dan ditafsirkan sesuai dengan hukum Republik Indonesia. Segala
            perselisihan yang timbul akan diselesaikan melalui musyawarah mufakat, dan apabila tidak tercapai kesepakatan,
            akan diselesaikan melalui Badan Arbitrase Perdagangan Berjangka Komoditi (BAPPEBTI).
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Pengguna menyetujui yurisdiksi eksklusif pengadilan yang berwenang di Jakarta, Indonesia.
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
