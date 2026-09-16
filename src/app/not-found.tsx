import Link from 'next/link'
import { Activity, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Halaman 404 — path selain `/` tidak ada di aplikasi ini.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <main className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
          <Activity className="h-6 w-6" />
        </div>
        <h1 className="font-mono text-4xl font-bold tracking-tight">404</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Halaman tidak ditemukan. FINEX AI hanya memiliki satu route utama.
        </p>
        <Button asChild className="mt-6 gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
          <Link href="/">
            <Home className="h-4 w-4" />
            Kembali ke Dashboard
          </Link>
        </Button>
      </main>
    </div>
  )
}
