"use client";

import { useCallback, useEffect, useState, type ElementType } from "react";
import { toast } from "sonner";
import {
  Bell,
  BellRing,
  DollarSign,
  Loader2,
  Mail,
  Newspaper,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Panel, Pill, SectionHeader } from "@/components/shared";
import { useStore } from "@/lib/store";
import { PAIRS } from "@/lib/constants";
import type { AlertRow, Pair } from "@/lib/types";

type AlertType = "PRICE" | "EMAIL" | "NEWS";
type Condition = "ABOVE" | "BELOW";

const TYPE_LABEL: Record<AlertType, string> = {
  PRICE: "Harga",
  EMAIL: "Email",
  NEWS: "Berita",
};
const TYPE_ICON: Record<AlertType, ElementType> = {
  PRICE: DollarSign,
  EMAIL: Mail,
  NEWS: Newspaper,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AlertsSection() {
  const alerts = useStore((s) => s.alerts);
  const setAlerts = useStore((s) => s.setAlerts);
  const quotes = useStore((s) => s.quotes);

  const [type, setType] = useState<AlertType>("PRICE");
  const [pair, setPair] = useState<Pair>("EURUSD");
  const [condition, setCondition] = useState<Condition>("ABOVE");
  const [price, setPrice] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true); // M5: skeleton state
  const [testingEmail, setTestingEmail] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      if (data?.alerts) setAlerts(data.alerts);
    } catch {
      toast.error("Gagal memuat alert"); // M3: was silently swallowed
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [setAlerts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // C1: Poll alert checks every 10s (independent of autoMode)
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/alerts/check", { method: "POST" });
        const data = await res.json();
        // If any alerts triggered, refresh the list
        if (data?.price?.triggered > 0 || data?.news?.matched > 0) {
          await refresh();
          if (data.price.triggered > 0) {
            toast.success("Price alert triggered", {
              description: `${data.price.triggered} alert ter-trigger, ${data.price.emailsSent} email terkirim.`,
            });
          }
          if (data.news.matched > 0) {
            toast.success("News alert matched", {
              description: `${data.news.matched} keyword match ditemukan.`,
            });
          }
        }
      } catch {
        /* ignore — next poll will retry */
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Prefill price when pair or type changes
  useEffect(() => {
    if (type !== "PRICE") return;
    const q = useStore.getState().quotes[pair];
    if (q?.last) {
      const digits = PAIRS.find((it) => it.symbol === pair)?.digits ?? 5;
      setPrice(q.last.toFixed(digits));
    }
  }, [type, pair]);

  const handleSubmit = async () => {
    let body: Partial<AlertRow> = { type, active: true };
    if (type === "PRICE") {
      const p = parseFloat(price);
      if (!pair || Number.isNaN(p) || p <= 0) {
        toast.error("Lengkapi pair dan harga target (harus > 0)");
        return;
      }
      body = { ...body, symbol: pair, condition, price: p };
    } else if (type === "EMAIL") {
      // H1: proper email validation (was !email.includes("@"))
      if (!email || !EMAIL_RE.test(email)) {
        toast.error("Masukkan email yang valid", {
          description: "Format: nama@domain.com",
        });
        return;
      }
      body = { ...body, email, message: message || null };
    } else {
      // H2: NEWS form validation (was no checks)
      if (!message.trim()) {
        toast.error("Keyword diperlukan untuk NEWS alert", {
          description: "Pisahkan beberapa keyword dengan koma (cth: NFP, rate, cut).",
        });
        return;
      }
      body = { ...body, symbol: pair, message };
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "create failed");
      }
      toast.success("Alert dibuat", {
        description: `Tipe: ${TYPE_LABEL[type]}${pair ? ` · ${pair}` : ""}`,
      });
      setMessage("");
      await refresh();
    } catch (e) {
      toast.error("Gagal membuat alert", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    const prev = alerts;
    setAlerts(alerts.filter((a) => a.id !== id));
    try {
      const res = await fetch("/api/alerts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("delete failed");
      toast.success("Alert dihapus");
    } catch {
      setAlerts(prev);
      toast.error("Gagal menghapus alert");
    }
  };

  const handleToggleActive = async (a: AlertRow) => {
    const newActive = !a.active;
    setAlerts(alerts.map((x) => (x.id === a.id ? { ...x, active: newActive } : x)));
    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, active: newActive }),
      });
      if (!res.ok) throw new Error("PATCH failed");
      toast.success(newActive ? "Alert diaktifkan" : "Alert dinonaktifkan");
    } catch {
      setAlerts(alerts.map((x) => (x.id === a.id ? { ...x, active: a.active } : x)));
      toast.error("Gagal mengubah status alert");
    }
  };

  // L6: Reset triggered alert (re-arm)
  const handleResetTriggered = async (id: string) => {
    try {
      const res = await fetch("/api/alerts/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("reset failed");
      toast.success("Alert re-armed");
      await refresh();
    } catch {
      toast.error("Gagal reset alert");
    }
  };

  // C2: Real test email (was toast stub)
  const handleTestEmail = async () => {
    const testEmail = emailAlert?.email || email;
    if (!testEmail || !EMAIL_RE.test(testEmail)) {
      toast.error("Masukkan email yang valid di form terlebih dahulu");
      return;
    }
    setTestingEmail(true);
    try {
      const res = await fetch("/api/alerts/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail }),
      });
      const data = await res.json();
      if (data.sent) {
        toast.success("Email test terkirim", {
          description: `Cek inbox ${testEmail} untuk konfirmasi.`,
        });
      } else {
        toast.info("Email test (sandbox mode)", {
          description: data.reason || "SMTP belum dikonfigurasi. Email dicatat di system logs.",
        });
      }
    } catch {
      toast.error("Gagal mengirim email test");
    } finally {
      setTestingEmail(false);
    }
  };

  // M4: count all email alerts (was only first)
  const emailAlerts = alerts.filter((a) => a.type === "EMAIL" && a.email);
  const triggeredCount = alerts.filter((a) => a.triggered).length;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Alert & Notifikasi"
        description="Alert harga real-time, notifikasi email, dan alert berita dengan keyword matching."
        icon={<Bell className="size-5" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Create form */}
        <Panel title="Buat Alert" description="Pilih tipe alert dan isi detail">
          <div className="space-y-4">
            <ToggleGroup
              type="single"
              value={type}
              onValueChange={(v) => { if (v) setType(v as AlertType); }}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="PRICE" className="flex-1">
                <DollarSign className="mr-1.5 size-3.5" /> Harga
              </ToggleGroupItem>
              <ToggleGroupItem value="EMAIL" className="flex-1">
                <Mail className="mr-1.5 size-3.5" /> Email
              </ToggleGroupItem>
              <ToggleGroupItem value="NEWS" className="flex-1">
                <Newspaper className="mr-1.5 size-3.5" /> Berita
              </ToggleGroupItem>
            </ToggleGroup>

            {type === "PRICE" && (
              <div className="space-y-3">
                <Field label="Pair">
                  <Select value={pair} onValueChange={(v) => setPair(v as Pair)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAIRS.map((p) => (
                        <SelectItem key={p.symbol} value={p.symbol}>{p.symbol}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Kondisi">
                  <ToggleGroup
                    type="single"
                    value={condition}
                    onValueChange={(v) => { if (v) setCondition(v as Condition); }}
                    variant="outline"
                    className="w-full"
                  >
                    <ToggleGroupItem value="ABOVE" className="flex-1">≥ Harga Saat Ini</ToggleGroupItem>
                    <ToggleGroupItem value="BELOW" className="flex-1">≤ Harga Saat Ini</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <Field label="Harga Target">
                  <Input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00000"
                    className="tnum"
                  />
                </Field>
                {quotes[pair] && (
                  <p className="text-xs text-muted-foreground tnum">
                    Harga saat ini: {quotes[pair].last.toFixed(PAIRS.find((p) => p.symbol === pair)?.digits ?? 5)}
                  </p>
                )}
              </div>
            )}

            {type === "EMAIL" && (
              <Field label="Email Penerima">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@domain.com"
                />
              </Field>
            )}

            {type === "NEWS" && (
              <div className="space-y-3">
                <Field label="Pair">
                  <Select value={pair} onValueChange={(v) => setPair(v as Pair)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAIRS.map((p) => (
                        <SelectItem key={p.symbol} value={p.symbol}>{p.symbol}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Keyword (pisahkan dengan koma)">
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="NFP, rate cut, CPI, intervention"
                    rows={2}
                  />
                </Field>
              </div>
            )}

            {type !== "NEWS" && (
              <Field label="Pesan (opsional)">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Catatan tambahan..."
                  rows={2}
                />
              </Field>
            )}

            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Buat Alert
            </Button>
          </div>
        </Panel>

        {/* Alert list */}
        <Panel
          title="Alert Aktif"
          description={`${alerts.length} alert${triggeredCount > 0 ? ` · ${triggeredCount} triggered` : ""}`}
          actions={
            <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
              Refresh
            </Button>
          }
          bodyClassName="p-2"
        >
          <div className="max-h-96 overflow-y-auto scroll-thin px-2 py-1">
            {/* M5: skeleton during initial load */}
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : alerts.length === 0 ? (
              <EmptyState
                icon={<BellRing className="size-8" />}
                title="Belum ada alert"
                description="Buat alert harga, email, atau berita dari panel kiri."
              />
            ) : (
              <div className="space-y-2">
                {alerts.map((a) => {
                  const Icon = TYPE_ICON[a.type];
                  return (
                    <div
                      key={a.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3 transition-colors hover:bg-card"
                    >
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {a.type === "EMAIL" ? "Email Alert" : (a.symbol ?? "—")}
                          </span>
                          <Pill className="gap-1">{TYPE_LABEL[a.type]}</Pill>
                          {a.triggered && <Pill tone="warn">Triggered</Pill>}
                          {!a.active && <Pill>Nonaktif</Pill>}
                        </div>
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {a.type === "PRICE" && a.price !== null && (
                            <div className="tnum">
                              {a.condition === "ABOVE" ? "≥ " : "≤ "}{a.price}
                            </div>
                          )}
                          {a.type === "EMAIL" && a.email && (
                            <div className="truncate">{a.email}</div>
                          )}
                          {a.type === "NEWS" && a.message && (
                            <div className="truncate">Keyword: {a.message}</div>
                          )}
                          {a.message && a.type !== "NEWS" && (
                            <div className="truncate">· {a.message}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {a.triggered && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
                            onClick={() => handleResetTriggered(a.id)}
                            aria-label="Re-arm alert"
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        )}
                        <Switch
                          checked={a.active}
                          onCheckedChange={() => handleToggleActive(a)}
                          aria-label="Toggle alert active"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-rose-400"
                          onClick={() => handleDelete(a.id)}
                          aria-label="Delete alert"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Notification status */}
      <Panel
        title="Status Notifikasi"
        description="Konfigurasi email & sistem notifikasi"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {/* M4: show all email alerts count */}
          <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-muted-foreground" />
              <span className="font-medium">Email Notification</span>
              {emailAlerts.length > 0 ? (
                <Badge variant="outline" className="ml-auto gap-1.5 border-emerald-500/40 text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500 live-dot" />
                  {emailAlerts.length} penerima
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-auto text-muted-foreground">Idle</Badge>
              )}
            </div>
            {emailAlerts.length > 0 ? (
              <div className="space-y-1">
                {emailAlerts.slice(0, 3).map((a) => (
                  <p key={a.id} className="text-xs text-muted-foreground truncate">{a.email}</p>
                ))}
                {emailAlerts.length > 3 && (
                  <p className="text-xs text-muted-foreground">+{emailAlerts.length - 3} lainnya</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Belum ada alert email. Buat satu di panel kiri.
              </p>
            )}
          </div>

          {/* M6: honest SMTP copy */}
          <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <BellRing className="size-4 text-muted-foreground" />
                <span className="font-medium">Test Email</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestEmail}
                disabled={testingEmail}
              >
                {testingEmail ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                Kirim Test
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {emailAlerts.length > 0 || email
                ? "Kirim email test untuk verifikasi konfigurasi SMTP. Set SMTP_HOST, SMTP_USER, SMTP_PASS di .env untuk aktifkan pengiriman real."
                : "Isi email di form kiri atau buat EMAIL alert dulu, lalu kirim test."}
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
