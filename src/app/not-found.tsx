'use client';

import { FileQuestion, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 items-center justify-center p-4">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
          <FileQuestion className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Halaman Tidak Ditemukan</h1>
        <p className="text-sm text-zinc-400">
          Maaf, halaman yang Anda cari tidak tersedia.
        </p>
        <Button
          onClick={() => router.push('/')}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Home className="w-4 h-4 mr-2" /> Kembali ke Dashboard
        </Button>
        <div className="pt-4 border-t border-zinc-800">
          <p className="text-[10px] text-zinc-600">FINEX Indonesia · Terdaftar di BAPPEBTI</p>
        </div>
      </div>
    </div>
  );
}
