'use client';

import { useState, useEffect } from 'react';
import {
  ShieldCheck, ShieldOff, Copy, Check, Loader2, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

// ============================================================
// Types
// ============================================================

type TwoFaStep = 'setup' | 'verified' | 'disable';

interface TwoFaStatus {
  enabled: boolean;
}

interface TwoFaSetupResponse {
  qrCodeUrl: string;
  secret: string;
}

// ============================================================
// Component: TwoFactorSetup
// ============================================================

export function TwoFactorSetup() {
  const [step, setStep] = useState<TwoFaStep | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);

  // Setup state
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Disable state
  const [disableCode, setDisableCode] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Copied secret state
  const [secretCopied, setSecretCopied] = useState(false);

  // ---- Fetch 2FA status ----
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/auth/2fa/status');
        if (res.ok) {
          const data: TwoFaStatus = await res.json();
          if (!cancelled) {
            setTwoFaEnabled(data.enabled);
            setStep(data.enabled ? 'verified' : 'setup');
          }
        } else {
          if (!cancelled) {
            setTwoFaEnabled(false);
            setStep('setup');
          }
        }
      } catch {
        if (!cancelled) {
          setTwoFaEnabled(false);
          setStep('setup');
        }
      } finally {
        if (!cancelled) {
          setStatusLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ---- Request setup (get QR + secret) ----
  const handleSetup = async () => {
    setSetupLoading(true);
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      if (res.ok) {
        const data: TwoFaSetupResponse = await res.json();
        setQrCodeUrl(data.qrCodeUrl);
        setSecret(data.secret);
        setStep('setup');
      } else {
        toast.error('Gagal memulai setup 2FA');
      }
    } catch {
      toast.error('Gagal memulai setup 2FA');
    }
    setSetupLoading(false);
  };

  // ---- Verify code ----
  const handleVerify = async () => {
    if (verifyCode.length !== 6) {
      toast.error('Masukkan kode 6 digit');
      return;
    }
    setVerifyLoading(true);
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyCode }),
      });
      if (res.ok) {
        toast.success('2FA berhasil diaktifkan!');
        setTwoFaEnabled(true);
        setStep('verified');
        setVerifyCode('');
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Kode verifikasi salah');
      }
    } catch {
      toast.error('Gagal memverifikasi kode');
    }
    setVerifyLoading(false);
  };

  // ---- Disable 2FA ----
  const handleDisable = async () => {
    if (disableCode.length !== 6) {
      toast.error('Masukkan kode 6 digit');
      return;
    }
    setDisableLoading(true);
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: disableCode }),
      });
      if (res.ok) {
        toast.success('2FA berhasil dinonaktifkan');
        setTwoFaEnabled(false);
        setStep('setup');
        setDisableCode('');
        setConfirmOpen(false);
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Kode salah atau gagal menonaktifkan');
      }
    } catch {
      toast.error('Gagal menonaktifkan 2FA');
    }
    setDisableLoading(false);
  };

  // ---- Copy secret to clipboard ----
  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      toast.success('Kode rahasia disalin');
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      toast.error('Gagal menyalin kode');
    }
  };

  // ---- Handle code input (digits only, max 6) ----
  const handleCodeInput = (value: string, setter: (_v: string) => void) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 6);
    setter(cleaned);
  };

  // ---- Loading state ----
  if (statusLoading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 bg-zinc-800" />
            <Skeleton className="h-5 w-40 bg-zinc-800" />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <Skeleton className="h-32 w-full bg-zinc-800" />
          <Skeleton className="h-10 w-full bg-zinc-800" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-zinc-400" />
            <CardTitle className="text-sm font-medium text-zinc-100">
              Autentikasi Dua Faktor
            </CardTitle>
          </div>
          {twoFaEnabled && step === 'verified' && (
            <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/30">
              2FA Aktif
            </Badge>
          )}
          {!twoFaEnabled && (step === 'setup' || step === null) && (
            <Badge variant="outline" className="text-zinc-500 border-zinc-700">
              Tidak Aktif
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs text-zinc-500">
          Tingkatkan keamanan akun dengan autentikasi dua faktor
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
        {/* ---- Step: Setup ---- */}
        {(step === 'setup') && (
          <div className="space-y-4">
            {!qrCodeUrl ? (
              <>
                <div className="text-center py-4">
                  <ShieldOff className="h-10 w-10 text-zinc-600 mx-auto mb-3" />
                  <p className="text-sm text-zinc-300 mb-1">2FA belum diaktifkan</p>
                  <p className="text-xs text-zinc-500 mb-4">
                    Aktifkan untuk melindungi akun Anda dengan lapisan keamanan tambahan
                  </p>
                  <Button
                    onClick={handleSetup}
                    disabled={setupLoading}
                    className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  >
                    {setupLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Mulai Setup 2FA
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* QR Code */}
                <div className="text-center">
                  <Label className="text-xs text-zinc-400 mb-2 block">
                    Pindai Kode QR
                  </Label>
                  <div className="inline-block p-3 bg-white rounded-lg">
                    <img
                      src={qrCodeUrl}
                      alt="QR Code 2FA"
                      className="w-48 h-48 sm:w-56 sm:h-56"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Manual secret */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">Masukkan Kode Manual</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono text-zinc-200 select-all">
                      {secret}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0 h-9 w-9 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      onClick={handleCopySecret}
                    >
                      {secretCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    Jika tidak bisa memindai QR, masukkan kode ini secara manual ke aplikasi authenticator
                  </p>
                </div>

                {/* Verify code input */}
                <div className="space-y-2">
                  <Label htmlFor="verify-code" className="text-xs text-zinc-400">
                    Verifikasi
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="verify-code"
                      type="text"
                      inputMode="numeric"
                      placeholder="Masukkan 6 digit kode"
                      maxLength={6}
                      value={verifyCode}
                      onChange={(e) => handleCodeInput(e.target.value, setVerifyCode)}
                      className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 font-mono text-center tracking-[0.3em] text-lg"
                    />
                  </div>
                  <Button
                    onClick={handleVerify}
                    disabled={verifyCode.length !== 6 || verifyLoading}
                    className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  >
                    {verifyLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Verifikasi
                  </Button>
                </div>

                {/* Regenerate QR link */}
                <div className="text-center">
                  <button
                    onClick={handleSetup}
                    disabled={setupLoading}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${setupLoading ? 'animate-spin' : ''}`} />
                    Buat kode QR baru
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- Step: Verified (2FA active) ---- */}
        {step === 'verified' && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-600/20 mb-3">
                <ShieldCheck className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="text-sm text-zinc-200 font-medium mb-1">2FA Aktif</p>
              <p className="text-xs text-zinc-500">
                Akun Anda dilindungi oleh autentikasi dua faktor.
                Setiap kali login, Anda akan diminta memasukkan kode dari aplikasi authenticator.
              </p>
            </div>

            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs text-zinc-500 mb-3">Ingin menonaktifkan 2FA?</p>

              <div className="space-y-2">
                <Label htmlFor="disable-code" className="text-xs text-zinc-400">
                  Nonaktifkan 2FA
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="disable-code"
                    type="text"
                    inputMode="numeric"
                    placeholder="Masukkan kode 6 digit saat ini"
                    maxLength={6}
                    value={disableCode}
                    onChange={(e) => handleCodeInput(e.target.value, setDisableCode)}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 font-mono text-center tracking-[0.3em] text-lg"
                  />
                </div>

                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full border-red-600/30 text-red-400 hover:bg-red-600/10 hover:text-red-300"
                      disabled={disableCode.length !== 6}
                    >
                      Nonaktifkan 2FA
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-zinc-900 border-zinc-800">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-zinc-100">
                        Nonaktifkan Autentikasi Dua Faktor?
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-zinc-400">
                        Tindakan ini akan menonaktifkan keamanan 2FA pada akun Anda.
                        Akun akan menjadi kurang aman tanpa 2FA. Lanjutkan?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700">
                        Batal
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDisable}
                        disabled={disableLoading}
                        className="bg-red-600 text-white hover:bg-red-700"
                      >
                        {disableLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Ya, Nonaktifkan
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
