'use client'

import { useEffect } from 'react'
import { Activity, RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Error boundary global — menangkap error render/dashboard tak terduga
 * agar pengguna melihat halaman pemulihan yang rapi, bukan blank screen.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Kirim ke console server-side log (bisa dipantau di dev.log/server.log)
    console.error('[ERROR-BOUNDARY]', error.message, error.digest ?? '')
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <main className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
          <TriangleAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold tracking-tight">Terjadi Kesalahan</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Dashboard mengalami error tak terduga. Data trading Anda aman — coba muat ulang.
          Bila berlanjut, lihat tab Logs atau jalankan pemulihan di bawah.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">ref: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
            <RotateCw className="h-4 w-4" />
            Coba Lagi
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.location.replace('/')}
          >
            <Activity className="h-4 w-4" />
            Muat Ulang Dashboard
          </Button>
        </div>
      </main>
    </div>
  )
}
