'use client'

import { useState } from 'react'
import { Activity, Eye, EyeOff, Lock, LogIn, ShieldCheck, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface LoginScreenProps {
  /** true bila belum ada ADMIN_PASSWORD_HASH/ADMIN_PASSWORD di env (mode default). */
  usingDefaultPassword: boolean
  defaultUsername: string
  defaultPassword: string
}

/**
 * Layar login FINEX AI — satu-satunya gerbang ke dashboard.
 * Rendered oleh `/` (server component) saat belum ada session valid.
 */
export function LoginScreen({ usingDefaultPassword, defaultUsername, defaultPassword }: LoginScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      if (res.ok) {
        // Full reload agar seluruh state client di-reset bersih
        window.location.replace('/')
        return
      }
      setError(json.message ?? `Login gagal (${res.status}).`)
    } catch {
      setError('Tidak dapat terhubung ke server. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {/* Latar dekoratif halus */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-72 w-72 rounded-full bg-emerald-600/5 blur-3xl" />
      </div>

      <main className="relative z-10 w-full max-w-sm">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
            <Activity className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            FINEX<span className="text-emerald-500">AI</span>
          </h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Trading System</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border bg-card p-6 shadow-sm"
          aria-label="Formulir login"
          noValidate
        >
          <div className="mb-4 flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-xs font-medium">Area terlindungi — masuk untuk melanjutkan</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-username" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Username
              </Label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-username"
                  autoComplete="username"
                  className="pl-8"
                  placeholder="Username admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  required
                  maxLength={100}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pl-8 pr-9"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500" role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={loading}>
              {loading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                  Memverifikasi…
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Masuk
                </>
              )}
            </Button>
          </div>

          {usingDefaultPassword ? (
            <Alert className="mt-4 border-amber-500/30 bg-amber-500/10">
              <AlertTitle className="text-xs font-semibold text-amber-500">
                Mode kredensial default
              </AlertTitle>
              <AlertDescription className="mt-1 space-y-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                <p>
                  Belum ada <code className="rounded bg-amber-500/10 px-1">ADMIN_PASSWORD_HASH</code>{' '}
                  di <code className="rounded bg-amber-500/10 px-1">.env</code>, sistem memakai
                  password default:
                </p>
                <p className="font-mono">
                  {defaultUsername} / {defaultPassword}
                </p>
                <p>
                  Untuk produksi: jalankan <code className="rounded bg-amber-500/10 px-1">bun run hash-password &lt;passwordBaru&gt;</code>{' '}
                  lalu isi <code className="rounded bg-amber-500/10 px-1">ADMIN_PASSWORD_HASH</code> — lihat PRODUCTION.md.
                </p>
              </AlertDescription>
            </Alert>
          ) : null}
        </form>

        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          Sesi berlaku 7 hari · 5 percobaan gagal = terkunci 15 menit
        </p>
      </main>
    </div>
  )
}
