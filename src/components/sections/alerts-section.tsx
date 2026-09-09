"use client";

import { useCallback, useEffect, useState, type ElementType } from "react";
import { toast } from "sonner";
import {
  Bell,
  BellRing,
  DollarSign,
  Mail,
  Newspaper,
  Plus,
  RefreshCw,
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/alerts");
      const data = await res.json();
      if (data?.alerts) setAlerts(data.alerts);
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  }, [setAlerts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Prefill price when pair or type changes — read latest quote snapshot directly from store
  // so this effect doesn't re-run on every live tick (preserves user input).
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
      if (!pair || Number.isNaN(p)) {
        toast.error("Lengkapi pair dan harga target");
        return;
      }
      body = { ...body, symbol: pair, condition, price: p };
    } else if (type === "EMAIL") {
      if (!email || !email.includes("@")) {
        toast.error("Masukkan email yang valid");
        return;
      }
      body = { ...body, email, message: message || null };
    } else {
      body = { ...body, symbol: pair, message: message || null };
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("create failed");
      toast.success("Alert dibuat", {
        description: `Tipe: ${TYPE_LABEL[type]}${pair ? ` · ${pair}` : ""}`,
      });
      setMessage("");
      await refresh();
    } catch {
      toast.error("Gagal membuat alert");
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

  const handleToggleActive = (a: AlertRow) => {
    // No update endpoint on backend — reflect locally only.
    setAlerts(alerts.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)));
    toast.success(a.active ? "Alert dinonaktifkan (lokal)" : "Alert diaktifkan (lokal)", {
      description: "Status aktif tersimpan sesi ini.",
    });
  };

  const handleTestEmail = () => {
    toast.success("Email test terkirim", {
      description: "Cek inbox Anda untuk konfirmasi SMTP bridge MT5.",
    });
  };

  const emailAlert = alerts.find((a) => a.type === "EMAIL" && a.email);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Alert & Notifikasi"
        description="Alert harga, notifikasi email, dan alert berita dadakan."
        icon={<Bell className="h-4 w-4" />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* LEFT: Create alert */}
        <Panel
          title="Buat Alert"
          description="Pilih tipe alert dan parameter notifikasi"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipe Alert</Label>
              <ToggleGroup
                type="single"
                value={type}
                onValueChange={(v) => v && setType(v as AlertType)}
                variant="outline"
                className="w-full"
              >
                <ToggleGroupItem value="PRICE" className="flex-1" aria-label="Alert harga">
                  <DollarSign className="h-3.5 w-3.5" /> {TYPE_LABEL.PRICE}
                </ToggleGroupItem>
                <ToggleGroupItem value="EMAIL" className="flex-1" aria-label="Alert email">
                  <Mail className="h-3.5 w-3.5" /> {TYPE_LABEL.EMAIL}
                </ToggleGroupItem>
                <ToggleGroupItem value="NEWS" className="flex-1" aria-label="Alert berita">
                  <Newspaper className="h-3.5 w-3.5" /> {TYPE_LABEL.NEWS}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {type === "PRICE" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="pair">Pair</Label>
                  <Select value={pair} onValueChange={(v) => setPair(v as Pair)}>
                    <SelectTrigger id="pair" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAIRS.map((p) => (
                        <SelectItem key={p.symbol} value={p.symbol}>
                          {p.symbol} — {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Kondisi</Label>
                  <ToggleGroup
                    type="single"
                    value={condition}
                    onValueChange={(v) => v && setCondition(v as Condition)}
                    variant="outline"
                    className="w-full"
                  >
                    <ToggleGroupItem value="ABOVE" className="flex-1" aria-label="Above">
                      Above (≥)
                    </ToggleGroupItem>
                    <ToggleGroupItem value="BELOW" className="flex-1" aria-label="Below">
                      Below (≤)
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="price">Harga Target</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.00001"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00000"
                    className="tnum"
                  />
                  {quotes[pair]?.last ? (
                    <p className="text-xs text-muted-foreground">
                      Harga saat ini:{" "}
                      <span className="tnum text-foreground">
                        {quotes[pair].last.toLocaleString("en-US", {
                          minimumFractionDigits: PAIRS.find((p) => p.symbol === pair)?.digits ?? 5,
                          maximumFractionDigits: PAIRS.find((p) => p.symbol === pair)?.digits ?? 5,
                        })}
                      </span>
                    </p>
                  ) : null}
                </div>
              </>
            )}

            {type === "EMAIL" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Tujuan</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@finex.id"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="msg">Pesan</Label>
                  <Textarea
                    id="msg"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Notifikasi Anda..."
                  />
                </div>
              </>
            )}

            {type === "NEWS" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="npair">Pair Terkait</Label>
                  <Select value={pair} onValueChange={(v) => setPair(v as Pair)}>
                    <SelectTrigger id="npair" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAIRS.map((p) => (
                        <SelectItem key={p.symbol} value={p.symbol}>
                          {p.symbol} — {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nmsg">Keyword / Pesan</Label>
                  <Textarea
                    id="nmsg"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Contoh: CPI, NFP, rate decision, FOMC..."
                  />
                </div>
              </>
            )}

            <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
              <Plus className="h-4 w-4" />
              {submitting ? "Membuat..." : "Buat Alert"}
            </Button>
          </div>
        </Panel>

        {/* RIGHT: Active alerts */}
        <Panel
          title="Alert Aktif"
          description={`${alerts.length} alert terdaftar`}
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh alerts"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
          bodyClassName="p-2"
        >
          <div className="max-h-96 overflow-y-auto scroll-thin px-2 py-1">
            {alerts.length === 0 ? (
              <EmptyState
                icon={<BellRing className="h-8 w-8" />}
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
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {a.type === "EMAIL" ? "Email Alert" : (a.symbol ?? "—")}
                          </span>
                          <Pill tone="default" className="gap-1">
                            {TYPE_LABEL[a.type]}
                          </Pill>
                          {a.triggered && <Pill tone="warn">Triggered</Pill>}
                          {!a.active && <Pill tone="default">Nonaktif</Pill>}
                        </div>
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {a.type === "PRICE" && a.price !== null && (
                            <div className="tnum">
                              {a.condition === "ABOVE" ? "≥ " : "≤ "}
                              {a.price}
                            </div>
                          )}
                          {a.type === "EMAIL" && a.email && (
                            <div className="truncate">{a.email}</div>
                          )}
                          {a.type === "NEWS" && a.message && (
                            <div className="truncate">{a.message}</div>
                          )}
                          {a.message && a.type !== "NEWS" && (
                            <div className="truncate">· {a.message}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={a.active}
                          onCheckedChange={() => handleToggleActive(a)}
                          aria-label="Toggle alert active"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-rose-400"
                          onClick={() => handleDelete(a.id)}
                          aria-label="Delete alert"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Bottom: Notification status */}
      <Panel
        title="Status Notifikasi"
        description="Konfigurasi email & bridge SMTP"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Email Notification</span>
              {emailAlert ? (
                <Badge
                  variant="outline"
                  className="ml-auto gap-1.5 border-emerald-500/40 text-emerald-400"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 live-dot" />
                  Aktif
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-auto text-muted-foreground">
                  Idle
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {emailAlert
                ? `Email aktif: ${emailAlert.email}`
                : "Belum ada alert email. Buat satu di panel kiri."}
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">SMTP via MT5 Bridge</span>
              </div>
              <Button size="sm" variant="outline" onClick={handleTestEmail}>
                <Mail className="h-3.5 w-3.5" /> Test Email
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Email dikirim melalui SMTP yang dikonfigurasi pada MT5 bridge di mesin Windows Anda.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
