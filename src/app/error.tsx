'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ERROR BOUNDARY]', error);

    // Report client-side error to server for centralized logging
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'error',
        category: 'client-error',
        message: error.message || 'Unknown client error',
        metadata: JSON.stringify({
          digest: error.digest,
          name: error.name,
          stack: error.stack?.slice(0, 500),
          url: typeof window !== 'undefined' ? window.location.href : '',
        }),
      }),
    }).catch(() => { /* best-effort */ });
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 items-center justify-center p-4">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-rose-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Terjadi Kesalahan</h1>
        <p className="text-sm text-zinc-400">
          Mohon maaf, sistem mengalami gangguan. Silakan coba lagi atau hubungi tim dukungan kami.
        </p>
        {error.digest && (
          <p className="text-xs text-zinc-600 font-mono">Error ID: {error.digest}</p>
        )}
        <Button
          onClick={reset}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <RefreshCw className="w-4 h-4 mr-2" /> Coba Lagi
        </Button>
        <div className="pt-4 border-t border-zinc-800">
          <p className="text-[10px] text-zinc-600">FINEX Indonesia · Terdaftar di BAPPEBTI</p>
        </div>
      </div>
    </div>
  );
}
