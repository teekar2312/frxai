'use client';

import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto w-full px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Kebijakan Privasi</h1>
              <p className="text-xs text-zinc-500">Terakhir diperbarui: 1 Januari 2025</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">1. Pengumpulan Data</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            FINEX Indonesia mengumpulkan data pribadi yang Anda berikan saat pendaftaran, termasuk nama, alamat
            email, dan informasi identitas. Kami juga mengumpulkan data teknis seperti alamat IP, jenis browser,
            dan data penggunaan platform secara otomatis.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Data keuangan seperti riwayat transaksi dan informasi akun trading dikumpulkan sesuai dengan ketentuan
            regulasi BAPPEBTI danUndang-Undang Perlindungan Data Pribadi (UU PDP) No. 27 Tahun 2022.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">2. Penggunaan Data</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Data pribadi Anda digunakan untuk menyediakan dan meningkatkan layanan platform, memproses transaksi,
            memverifikasi identitas, mengirimkan pemberitahuan penting, dan memenuhi kewajiban regulasi.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Kami tidak akan menjual, menyewakan, atau membagikan data pribadi Anda kepada pihak ketiga untuk
            tujuan pemasaran tanpa persetujuan eksplisit dari Anda. Data hanya dibagikan kepada pihak yang
            berwenang sesuai ketentuan hukum yang berlaku.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">3. Keamanan Data</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Kami menerapkan langkah-langkah keamanan teknis dan organisasi yang sesuai untuk melindungi data
            pribadi Anda, termasuk enkripsi data (SSL/TLS), kontrol akses ketat, dan audit keamanan berkala.
            Kata sandi disimpan menggunakan hashing bcrypt.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Meskipun kami berupaya semaksimal mungkin, tidak ada sistem yang sepenuhnya bebas risiko. Kami akan
            segera memberitahu Anda jika terjadi insiden keamanan data yang berdampak signifikan.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">4. Cookie</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Platform ini menggunakan cookie dan teknologi pelacakan serupa untuk meningkatkan pengalaman pengguna,
            mengingat preferensi, dan menganalisis penggunaan platform. Cookie yang diperlukan untuk fungsi
            platform tidak dapat dinonaktifkan.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Cookie analitik digunakan untuk memahami bagaimana pengguna berinteraksi dengan platform. Anda dapat
            mengatur preferensi cookie melalui pengaturan browser Anda.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white border-b border-zinc-800 pb-2">5. Hak Pengguna</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Sesuai UU PDP, Anda memiliki hak untuk mengakses, memperbaiki, menghapus, dan memindahkan data pribadi
            Anda. Anda juga berhak menarik persetujuan pengolahan data kapan saja. Untuk mengajukan permintaan
            terkait data pribadi, hubungi kami melalui halaman Kontak.
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Permintaan akan diproses dalam waktu 14 hari kerja. Beberapa data mungkin perlu dipertahankan sesuai
            ketentuan regulasi dan kewajiban hukum yang berlaku.
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
