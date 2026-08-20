'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Mail, Lock, User, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  name?: string;
  general?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!email.trim()) {
      newErrors.email = 'Email wajib diisi';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Format email tidak valid';
    }

    if (!password) {
      newErrors.password = 'Kata sandi wajib diisi';
    } else if (password.length < 8) {
      newErrors.password = 'Kata sandi minimal 8 karakter';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Konfirmasi kata sandi wajib diisi';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Kata sandi tidak cocok';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!validateForm()) return;

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (res.status === 403) {
        setErrors({ general: 'Pendaftaran dinonaktifkan' });
        return;
      }

      if (!res.ok) {
        if (res.status === 409) {
          setErrors({ email: 'Email sudah terdaftar' });
        } else {
          setErrors({ general: data.error || 'Pendaftaran gagal. Silakan coba lagi.' });
        }
        return;
      }

      toast.success('Pendaftaran berhasil! Silakan masuk ke akun Anda.');
      router.push('/login');
    } catch {
      setErrors({ general: 'Terjadi kesalahan jaringan. Silakan coba lagi.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-600/10 border border-emerald-500/20 mb-4">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">FINEX Indonesia</h1>
          <p className="text-sm text-zinc-400">Platform Trading Forex AI</p>
        </div>

        {/* Register Card */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg font-semibold text-white">Daftar Akun Baru</CardTitle>
            <CardDescription className="text-zinc-400 text-sm">
              Buat akun baru untuk mengakses dashboard trading
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {/* General error */}
              {errors.general && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {errors.general}
                </div>
              )}

              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-zinc-300 text-sm">
                  Nama Lengkap <span className="text-zinc-500 font-normal">(opsional)</span>
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500"
                    autoComplete="name"
                  />
                </div>
                {errors.name && (
                  <p className="text-xs text-rose-400 mt-1">{errors.name}</p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-zinc-300 text-sm">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500 ${errors.email ? 'border-rose-500' : ''}`}
                    required
                    autoComplete="email"
                  />
                </div>
                {errors.email && (
                  <p className="text-xs text-rose-400 mt-1">{errors.email}</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-300 text-sm">Kata Sandi</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Minimal 8 karakter"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500 ${errors.password ? 'border-rose-500' : ''}`}
                    required
                    autoComplete="new-password"
                    minLength={8}
                  />
                </div>
                {errors.password && (
                  <p className="text-xs text-rose-400 mt-1">{errors.password}</p>
                )}
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-zinc-300 text-sm">Konfirmasi Kata Sandi</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Ulangi kata sandi"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`pl-9 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-emerald-500 ${errors.confirmPassword ? 'border-rose-500' : ''}`}
                    required
                    autoComplete="new-password"
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="text-xs text-rose-400 mt-1">{errors.confirmPassword}</p>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-2">
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Mendaftar...</>
                ) : (
                  'Daftar Akun Baru'
                )}
              </Button>

              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Kembali ke halaman masuk
              </Link>
            </CardFooter>
          </form>
        </Card>

        {/* Footer */}
        <div className="text-center space-y-2">
          <p className="text-[10px] text-zinc-600">
            FINEX Indonesia · Terdaftar dan Diawasi oleh BAPPEBTI
          </p>
          <p className="text-[10px] text-zinc-700">
            Dengan mendaftar, Anda menyetujui syarat dan ketentuan kami
          </p>
        </div>
      </div>
    </div>
  );
}
