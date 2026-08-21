'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      setSent(true); // Still show success to prevent enumeration
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

        {sent ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-6 space-y-4">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600/10">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">Email Terkirim</h2>
                <p className="text-sm text-zinc-400">
                  Jika email terdaftar di sistem kami, link reset password telah dikirim ke{' '}
                  <span className="text-zinc-300 font-medium">{email}</span>.
                  Silakan periksa kotak masuk Anda.
                </p>
              </div>
              <div className="pt-2">
                <Link href="/login">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
                    Kembali ke Login
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-lg font-semibold text-white">Lupa Password</CardTitle>
              <CardDescription className="text-zinc-400 text-sm">
                Masukkan email Anda dan kami akan mengirimkan link untuk mengatur ulang password.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-zinc-300 text-sm">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@finex-indonesia.co.id"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-2 flex-col gap-3">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Mengirim...</>
                  ) : (
                    'Kirim Link Reset'
                  )}
                </Button>
                <Link href="/login" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                  Kembali ke Login
                </Link>
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
