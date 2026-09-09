"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Brain,
  Sparkles,
  Send,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Crosshair,
  Target,
  Shield,
  Cpu,
  Zap,
  MessageSquare,
  History,
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeader, Panel, Pill, EmptyState } from "@/components/shared";
import { useStore } from "@/lib/store";
import { AI_PROVIDERS, FACTOR_LIST, PAIRS } from "@/lib/constants";
import type {
  AiAnalysisResult,
  FactorScore,
  Pair,
  SignalDirection,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface SignalResult {
  id: string;
  symbol: Pair;
  side: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
}

type DirectionMeta = {
  tone: "up" | "down" | "default";
  color: string;
  bg: string;
  label: string;
  Icon: typeof TrendingUp;
};

function directionMeta(d: SignalDirection): DirectionMeta {
  if (d === "BUY")
    return {
      tone: "up",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/30",
      label: "BUY",
      Icon: TrendingUp,
    };
  if (d === "SELL")
    return {
      tone: "down",
      color: "text-rose-400",
      bg: "bg-rose-500/10 border-rose-500/30",
      label: "SELL",
      Icon: TrendingDown,
    };
  return {
    tone: "default",
    color: "text-muted-foreground",
    bg: "bg-muted/40 border-border",
    label: "NEUTRAL",
    Icon: Minus,
  };
}

export function AiSection() {
  const tradingCfg = useStore((s) => s.tradingCfg);
  const [symbol, setSymbol] = useState<Pair>(tradingCfg.pairs[0] ?? "EURUSD");
  const [providerLabel, setProviderLabel] = useState("Z.ai");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiAnalysisResult | null>(null);
  const [lastTime, setLastTime] = useState<Date | null>(null);
  const [executing, setExecuting] = useState(false);
  const [signal, setSignal] = useState<SignalResult | null>(null);
  const [signalReason, setSignalReason] = useState<string | null>(null);

  // chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "ai",
      text: "Halo! Saya asisten AI trading FINEX Indonesia. Tanyakan apapun tentang pasar forex, strategi scalping, atau analisa pair.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // fetch active provider on mount
  useEffect(() => {
    fetch("/api/config/keys")
      .then((r) => r.json())
      .then((d) => {
        const ap = d?.keys?.activeProvider as string | undefined;
        const found = AI_PROVIDERS.find((p) => p.key === ap);
        setProviderLabel(found ? found.label.split(" (")[0] : "Z.ai");
      })
      .catch(() => setProviderLabel("Z.ai"));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function runAnalysis() {
    setLoading(true);
    setResult(null);
    setSignal(null);
    setSignalReason(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) throw new Error("Analisa gagal");
      const data = await res.json();
      setResult(data.analysis as AiAnalysisResult);
      setLastTime(new Date());
      toast.success("Analisa AI selesai", {
        description: `${symbol}: ${data.analysis.signal} @ ${data.analysis.confidence}% confidence`,
      });
    } catch (e) {
      toast.error("Gagal menganalisa", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function executeSignal() {
    if (!result) return;
    setExecuting(true);
    setSignal(null);
    setSignalReason(null);
    try {
      const res = await fetch("/api/ai/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) throw new Error("Eksekusi sinyal gagal");
      const data = await res.json();
      if (data.signal) {
        setSignal(data.signal as SignalResult);
        toast.success("Sinyal dihasilkan", {
          description: `${data.signal.side} ${symbol} @ ${data.signal.entry}`,
        });
      } else {
        setSignalReason((data.reason as string) ?? "Sinyal dilewati");
        toast.info("Sinyal dilewati", {
          description: (data.reason as string) ?? "Confidence terlalu rendah",
        });
      }
    } catch (e) {
      toast.error("Gagal eksekusi sinyal", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setExecuting(false);
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      text,
    };
    setMessages((m) => [...m, userMsg]);
    setChatInput("");
    setChatSending(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error("Chat gagal");
      const data = await res.json();
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "ai",
          text: (data.reply as string) ?? "Tidak ada balasan.",
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "ai",
          text: "Maaf, terjadi kesalahan koneksi. Silakan coba lagi.",
        },
      ]);
      toast.error("Chat AI gagal");
    } finally {
      setChatSending(false);
    }
  }

  const sig = result ? directionMeta(result.signal) : null;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Pusat Analisa AI Multi-Faktor"
        description="Analisa kebijakan bank sentral, data ekonomi, geopolitik, komoditas, sentimen & breaking news."
        icon={<Brain className="size-5" />}
        actions={
          <>
            <Pill tone="accent">
              <Sparkles className="size-3" /> {providerLabel}
            </Pill>
            <Select value={symbol} onValueChange={(v) => setSymbol(v as Pair)}>
              <SelectTrigger size="sm" className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAIRS.map((p) => (
                  <SelectItem key={p.symbol} value={p.symbol}>
                    {p.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={runAnalysis} disabled={loading}>
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Zap className="size-4" />
              )}
              Analisa Sekarang
            </Button>
          </>
        }
      />

      {/* Faktor strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Faktor dianalisa:
        </span>
        {FACTOR_LIST.map((f, i) => (
          <Pill key={i} className="text-[10px]">
            {f}
          </Pill>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* LEFT — Hasil Analisa */}
        <div className="lg:col-span-2">
          <Panel
            title="Hasil Analisa"
            description={
              lastTime
                ? `Terakhir dianalisa: ${lastTime.toLocaleTimeString("id-ID")}`
                : "Belum ada analisa"
            }
            actions={
              result && sig ? (
                <Pill tone={sig.tone}>
                  <sig.Icon className="size-3" /> {sig.label}
                </Pill>
              ) : undefined
            }
          >
            {loading ? (
              <LoadingState symbol={symbol} />
            ) : !result ? (
              <EmptyState
                icon={<Brain className="size-10" />}
                title="Belum ada hasil analisa"
                description="Pilih pair lalu klik 'Analisa Sekarang'. AI memproses 7 faktor pasar (~10-20 detik)."
              />
            ) : (
              <ResultBody
                result={result}
                sig={sig!}
                executing={executing}
                signal={signal}
                signalReason={signalReason}
                onExecute={executeSignal}
              />
            )}
          </Panel>
        </div>

        {/* RIGHT — Chat & Riwayat */}
        <div>
          <Tabs defaultValue="chat">
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">
                <MessageSquare className="size-3.5" /> Chat AI
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1">
                <History className="size-3.5" /> Riwayat
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="mt-2">
              <div className="flex h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="flex-1 space-y-3 overflow-y-auto scroll-thin p-4">
                  {messages.map((m) => (
                    <ChatBubble key={m.id} msg={m} />
                  ))}
                  {chatSending && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Bot className="size-4 text-violet-400" />
                      <Loader2 className="size-3 animate-spin" /> AI sedang mengetik...
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="border-t border-border p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") sendChat();
                      }}
                      placeholder="Tanya AI tentang pasar..."
                      disabled={chatSending}
                    />
                    <Button
                      size="icon"
                      onClick={sendChat}
                      disabled={chatSending || !chatInput.trim()}
                    >
                      {chatSending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="history" className="mt-2">
              <Panel title="Riwayat Analisa" description="Tersimpan untuk self-learning AI">
                {lastTime ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{symbol}</span>
                        <span className="text-xs text-muted-foreground">
                          {lastTime.toLocaleString("id-ID")}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        {sig && (
                          <Pill tone={sig.tone}>
                            <sig.Icon className="size-3" /> {sig.label}
                          </Pill>
                        )}
                        <span className="text-xs text-muted-foreground">
                          Confidence{" "}
                          <span className="tnum">{result?.confidence}%</span>
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Setiap analisa disimpan di database untuk memory
                      self-learning AI. Model memperbaiki keputusan dari setiap
                      hasil yang tersimpan.
                    </p>
                  </div>
                ) : (
                  <EmptyState
                    icon={<History className="size-8" />}
                    title="Belum ada riwayat"
                    description="Jalankan analisa pertama Anda."
                  />
                )}
              </Panel>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Status Model AI */}
      <Panel
        title="Status Model AI"
        description="Multi-provider LLM dengan self-learning memory"
        actions={
          <Pill tone="accent">
            <Cpu className="size-3" /> Self-Learning Aktif
          </Pill>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {AI_PROVIDERS.map((p) => {
            const active = p.label
              .toLowerCase()
              .startsWith(providerLabel.toLowerCase());
            return (
              <div
                key={p.key}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  active
                    ? "border-violet-500/40 bg-violet-500/5"
                    : "border-border bg-muted/20",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {p.label.split(" (")[0]}
                  </span>
                  {active && (
                    <span className="h-2 w-2 rounded-full bg-violet-400 live-dot" />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
                {active && (
                  <p className="mt-2 text-[10px] font-medium text-violet-400">
                    AKTIF
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <Brain className="mt-0.5 size-4 shrink-0 text-violet-400" />
          <p className="text-xs text-muted-foreground">
            Model belajar mandiri dari setiap analisa (self-learning memory
            tersimpan di database). Semua hasil analisa multi-faktor dipersist
            untuk meningkatkan akurasi keputusan di masa depan.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function LoadingState({ symbol }: { symbol: Pair }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-violet-500/20" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10">
          <Brain className="size-8 text-violet-400" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">
          AI sedang menganalisa multi-faktor...
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {symbol} — proses ~10-20 detik
        </p>
      </div>
      <div className="grid w-full max-w-md grid-cols-1 gap-2">
        {FACTOR_LIST.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3 animate-spin text-violet-400" />
            <span>{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultBody({
  result,
  sig,
  executing,
  signal,
  signalReason,
  onExecute,
}: {
  result: AiAnalysisResult;
  sig: DirectionMeta;
  executing: boolean;
  signal: SignalResult | null;
  signalReason: string | null;
  onExecute: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* Signal banner */}
      <div className={cn("rounded-xl border p-4", sig.bg)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <sig.Icon className={cn("size-8", sig.color)} />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Sinyal AI
              </div>
              <div className={cn("text-2xl font-bold", sig.color)}>
                {sig.label}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Confidence
            </div>
            <div className={cn("text-3xl font-bold tnum", sig.color)}>
              {result.confidence}%
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Progress
            value={result.confidence}
            className={cn(
              "h-2",
              sig.tone === "up"
                ? "[&_[data-slot=progress-indicator]]:bg-emerald-500"
                : sig.tone === "down"
                  ? "[&_[data-slot=progress-indicator]]:bg-rose-500"
                  : "[&_[data-slot=progress-indicator]]:bg-violet-500",
            )}
          />
        </div>
      </div>

      {/* Summary */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Ringkasan
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">
          {result.summary}
        </p>
      </div>

      {/* Entry / SL / TP */}
      <div className="grid grid-cols-3 gap-3">
        <MiniStat
          label="Entry"
          value={result.suggestedEntry}
          icon={<Crosshair className="size-3.5" />}
          tone="default"
        />
        <MiniStat
          label="Stop Loss"
          value={result.suggestedStopLoss}
          icon={<Shield className="size-3.5" />}
          tone="down"
        />
        <MiniStat
          label="Take Profit"
          value={result.suggestedTakeProfit}
          icon={<Target className="size-3.5" />}
          tone="up"
        />
      </div>

      {/* Execute */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onExecute} disabled={executing}>
          {executing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
          Eksekusi Sinyal
        </Button>
        {signal && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs">
            <span className="font-semibold text-emerald-400">
              {signal.side} {signal.symbol}
            </span>
            <span className="text-muted-foreground">
              Entry <span className="tnum">{signal.entry}</span>
            </span>
            <span className="text-muted-foreground">
              SL <span className="tnum">{signal.stopLoss}</span>
            </span>
            <span className="text-muted-foreground">
              TP <span className="tnum">{signal.takeProfit}</span>
            </span>
            <span className="text-muted-foreground">
              Conf <span className="tnum">{signal.confidence}%</span>
            </span>
          </div>
        )}
        {signalReason && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
            {signalReason}
          </div>
        )}
      </div>

      {/* Factor heatmap */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Heatmap 7 Faktor Multi-Faktor
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-rose-500" /> Bearish
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Bullish
            </span>
          </div>
        </div>
        <div className="space-y-2.5">
          {result.factors.map((f, i) => (
            <FactorRow key={i} factor={f} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number | undefined;
  icon: ReactNode;
  tone: "default" | "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className={cn("mt-1.5 text-lg font-semibold tnum", color)}>
        {value != null ? value : "—"}
      </div>
    </div>
  );
}

function FactorRow({ factor }: { factor: FactorScore }) {
  const meta = directionMeta(factor.direction);
  const score = Math.max(-100, Math.min(100, factor.score));
  const widthPct = Math.abs(score) / 2; // 0..50 (half-width bar)
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{factor.factor}</span>
        <Pill tone={meta.tone === "up" ? "up" : meta.tone === "down" ? "down" : "default"}>
          <meta.Icon className="size-3" /> {meta.label}
        </Pill>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="w-8 text-right text-[10px] tnum text-rose-400/70">
          -100
        </span>
        <div className="relative h-2.5 flex-1 rounded-full bg-muted">
          <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
          {score >= 0 ? (
            <div
              className="absolute left-1/2 top-0 h-full rounded-r-full bg-emerald-500"
              style={{ width: `${widthPct}%` }}
            />
          ) : (
            <div
              className="absolute top-0 h-full rounded-l-full bg-rose-500"
              style={{ right: "50%", width: `${widthPct}%` }}
            />
          )}
        </div>
        <span className="w-8 text-[10px] tnum text-emerald-400/70">+100</span>
        <span
          className={cn(
            "w-12 text-right text-xs font-semibold tnum",
            meta.color,
          )}
        >
          {score > 0 ? "+" : ""}
          {score}
        </span>
      </div>
      {factor.detail && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {factor.detail}
        </p>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
          <Bot className="size-4 text-violet-400" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {msg.text}
      </div>
    </div>
  );
}
