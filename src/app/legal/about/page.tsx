'use client';

import Link from 'next/link';
import { ArrowLeft, Building2, Eye, Target, Users, Phone } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto w-full px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Tentang Kami</h1>
              <p className="text-xs text-zinc-500">FINEX Indonesia</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">Tentang FINEX Indonesia</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            FINEX Indonesia adalah platform perdagangan forex berbasis teknologi kecerdasan buatan (AI) yang
            beroperasi di bawah pengawasan Badan Pengawas Perdagangan Berjangka Komoditi (BAPPEBTI). Didirikan
            dengan visi menghadirkan teknologi trading modern yang aman dan terjangkau bagi trader Indonesia.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Kami menggabungkan analisis teknikal tingkat lanjut, pemrosesan bahasa alami untuk berita pasar,
            dan algoritma pembelajaran mesin untuk memberikan wawasan perdagangan yang akurat dan tepat waktu.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">Visi & Misi</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Visi</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Menjadi platform trading forex AI terdepan di Indonesia yang memberdayakan trader dengan
                teknologi cerdas, transparan, dan terpercaya.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Misi</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Menyediakan analisis pasar real-time berbasis AI, menjaga standar keamanan tertinggi, dan
                mendukung literasi keuangan melalui edukasi trading yang bertanggung jawab.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">Diawasi BAPPEBTI</h2>
          <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <p className="text-sm text-emerald-300 font-medium mb-2">
              ✅ Terdaftar dan Diawasi oleh BAPPEBTI
            </p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              FINEX Indonesia beroperasi sesuai dengan peraturan BAPPEBTI dan UU No. 10 Tahun 2011 tentang
              Perdagangan Berjangka Komoditi. Dana nasabah dijamin oleh Lembaga Kliring Berjangka Indonesia (LKBI)
              dan disimpan pada bank penampungan yang disetujui oleh BAPPEBTI.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">Tim</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Tim kami terdiri dari profesional berpengalaman di bidang teknologi finansial, data science, dan
            pasar keuangan. Dengan pengalaman gabungan lebih dari 50 tahun di industri keuangan, kami berkomitmen
            untuk menghadirkan inovasi yang bermanfaat bagi seluruh pengguna.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">Kontak</h2>
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Phone className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
              <div className="text-sm text-zinc-400">
                <p className="text-zinc-300 font-medium">Email</p>
                <p>support@finex-indonesia.co.id</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Users className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
              <div className="text-sm text-zinc-400">
                <p className="text-zinc-300 font-medium">Jam Operasional</p>
                <p>Senin - Jumat, 06:00 - 23:00 WIB (sesi pasar forex)</p>
              </div>
            </div>
          </div>
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
