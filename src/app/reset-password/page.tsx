'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Lock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // If no token, show error
  const hasToken = !!token;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password minimal 8 karakter.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Password dan konfirmasi tidak cocok.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (data.success) {
        setSuccess(true);
      } else {
        setError(data.message || 'Gagal mengubah password.');
      }
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Branding */}
        <div className="text-center space-y-2">
          <Link href="/" className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-600/10 border border-emerald-500/20 mb-4">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
          </Link>
          <h1 className="text-2xl font-bold text-white tracking-tight">FINEX Indonesia</h1>
          <p className="text-sm text-zinc-400">Platform Trading Forex AI</p>
        </div>

        {success ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-6 space-y-4">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600/10">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">Password Berhasil Diubah</h2>
                <p className="text-sm text-zinc-400">
                  Password Anda telah berhasil diperbarui. Silakan masuk dengan password baru Anda.
                </p>
              </div>
              <div className="pt-2">
                <Link href="/login">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
                    Masuk
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : !hasToken ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-6 space-y-4">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-600/10">
                  <AlertCircle className="w-6 h-6 text-rose-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">Token Tidak Valid</h2>
                <p className="text-sm text-zinc-400">
                  Link reset password tidak valid atau telah kedaluwarsa. Silakan minta link baru.
                </p>
              </div>
              <div className="pt-2">
                <Link href="/forgot-password">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
                    Minta Link Baru
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-lg font-semibold text-white">Atur Ulang Password</CardTitle>
              <CardDescription className="text-zinc-400 text-sm">
                Masukkan password baru Anda.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-zinc-300 text-sm">Password Baru</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Minimal 8 karakter"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                      required
                      autoComplete="new-password"
                      minLength={8}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-zinc-300 text-sm">Konfirmasi Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Ulangi password baru"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                      required
                      autoComplete="new-password"
                      minLength={8}
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Memproses...</>
                  ) : (
                    'Ubah Password'
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center">
          <p className="text-[10px] text-zinc-600">
            FINEX Indonesia · Terdaftar dan Diawasi oleh BAPPEBTI
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
