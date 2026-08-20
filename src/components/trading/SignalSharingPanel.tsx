'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Heart, MessageCircle, Share2, ChevronDown, ChevronUp, Loader2,
  TrendingUp, TrendingDown, Clock, Send, Plus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  EXTENDED_PAIRS, EXTENDED_PAIR_DISPLAY, EXTENDED_PAIR_PIP_VALUES,
  STRATEGY_LABELS, type TradingDirection, type StrategyName,
} from '@/lib/trading-types';

// ============================================================
// Types
// ============================================================

interface SharedSignal {
  id: string;
  userId: string;
  userName: string;
  pair: string;
  direction: TradingDirection;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasoning: string;
  strategy: string;
  likes: number;
  commentCount: number;
  isLiked: boolean;
  createdAt: string;
}

interface SignalComment {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
}

interface ShareFormData {
  pair: string;
  direction: TradingDirection;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  confidence: number;
  reasoning: string;
  strategy: string;
}

// ============================================================
// Helpers
// ============================================================

function fmtPrice(pair: string, price: number): string {
  const pipInfo = EXTENDED_PAIR_PIP_VALUES[pair];
  if (!pipInfo) return price.toFixed(5);
  const decimals = pipInfo.pipSize < 0.001 ? 5 : 3;
  return price.toFixed(decimals);
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Baru saja';
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} hari lalu`;
}

function confidenceColor(c: number): string {
  if (c >= 75) return 'text-emerald-400';
  if (c >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

function confidenceBarColor(c: number): string {
  if (c >= 75) return 'bg-emerald-500';
  if (c >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

const EMPTY_FORM: ShareFormData = {
  pair: 'EURUSD',
  direction: 'BUY',
  entry: '',
  stopLoss: '',
  takeProfit: '',
  confidence: 70,
  strategy: 'EMA_CROSSOVER',
  reasoning: '',
};

// ============================================================
// Component: SignalSharingPanel
// ============================================================

export function SignalSharingPanel() {
  // ---- Signals list state ----
  const [signals, setSignals] = useState<SharedSignal[]>([]);
  const [isLoadingSignals, setIsLoadingSignals] = useState(true);
  const [signalError, setSignalError] = useState<string | null>(null);

  // ---- Share dialog state ----
  const [shareOpen, setShareOpen] = useState(false);
  const [formData, setFormData] = useState<ShareFormData>(EMPTY_FORM);
  const [isSharing, setIsSharing] = useState(false);

  // ---- Comments state ----
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<Record<string, SignalComment[]>>({});
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [isLoadingComments, setIsLoadingComments] = useState<Record<string, boolean>>({});
  const [isPostingComment, setIsPostingComment] = useState<string | null>(null);

  // ---- Like state ----
  const [likingId, setLikingId] = useState<string | null>(null);

  // ---- Fetch shared signals ----
  const fetchSignals = useCallback(async () => {
    setIsLoadingSignals(true);
    setSignalError(null);
    try {
      const res = await fetch('/api/signals/shared');
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals ?? []);
      } else {
        setSignalError('Gagal memuat sinyal');
      }
    } catch {
      setSignalError('Gagal memuat sinyal');
    }
    setIsLoadingSignals(false);
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  // ---- Toggle comments ----
  const toggleComments = async (signalId: string) => {
    const newExpanded = new Set(expandedComments);
    if (newExpanded.has(signalId)) {
      newExpanded.delete(signalId);
      setExpandedComments(newExpanded);
      return;
    }
    newExpanded.add(signalId);
    setExpandedComments(newExpanded);

    // Fetch comments if not loaded
    if (!comments[signalId]) {
      setIsLoadingComments(prev => ({ ...prev, [signalId]: true }));
      try {
        const res = await fetch(`/api/signals/shared/${signalId}/comments`);
        if (res.ok) {
          const data = await res.json();
          setComments(prev => ({ ...prev, [signalId]: data.comments ?? [] }));
        }
      } catch {
        // ignore
      }
      setIsLoadingComments(prev => ({ ...prev, [signalId]: false }));
    }
  };

  // ---- Like signal ----
  const handleLike = async (signalId: string) => {
    setLikingId(signalId);
    try {
      const res = await fetch('/api/signals/shared', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: signalId, action: 'like' }),
      });
      if (res.ok) {
        setSignals(prev =>
          prev.map(s =>
            s.id === signalId
              ? { ...s, isLiked: !s.isLiked, likes: s.isLiked ? s.likes - 1 : s.likes + 1 }
              : s
          )
        );
      }
    } catch {
      toast.error('Gagal menyukai sinyal');
    }
    setLikingId(null);
  };

  // ---- Post comment ----
  const handlePostComment = async (signalId: string) => {
    const text = commentText[signalId]?.trim();
    if (!text) return;
    setIsPostingComment(signalId);
    try {
      const res = await fetch(`/api/signals/shared/${signalId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        const data = await res.json();
        const newComment = data.comment ?? { id: Date.now().toString(), userName: 'Anda', content: text, createdAt: new Date().toISOString() };
        setComments(prev => ({
          ...prev,
          [signalId]: [...(prev[signalId] ?? []), newComment],
        }));
        setCommentText(prev => ({ ...prev, [signalId]: '' }));
        // Update comment count
        setSignals(prev =>
          prev.map(s =>
            s.id === signalId ? { ...s, commentCount: s.commentCount + 1 } : s
          )
        );
      } else {
        toast.error('Gagal mengirim komentar');
      }
    } catch {
      toast.error('Gagal mengirim komentar');
    }
    setIsPostingComment(null);
  };

  // ---- Share signal ----
  const handleShare = async () => {
    const entry = parseFloat(formData.entry);
    const stopLoss = parseFloat(formData.stopLoss);
    const takeProfit = parseFloat(formData.takeProfit);

    if (isNaN(entry) || isNaN(stopLoss) || isNaN(takeProfit)) {
      toast.error('Masukkan harga entry, SL, dan TP yang valid');
      return;
    }
    if (!formData.reasoning.trim()) {
      toast.error('Masukkan alasan analisis');
      return;
    }

    setIsSharing(true);
    try {
      const res = await fetch('/api/signals/shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: formData.pair,
          direction: formData.direction,
          entry,
          stopLoss,
          takeProfit,
          confidence: formData.confidence,
          reasoning: formData.reasoning,
          strategy: formData.strategy,
        }),
      });
      if (res.ok) {
        toast.success('Sinyal berhasil dibagikan!');
        setShareOpen(false);
        setFormData(EMPTY_FORM);
        fetchSignals();
      } else {
        toast.error('Gagal membagikan sinyal');
      }
    } catch {
      toast.error('Gagal membagikan sinyal');
    }
    setIsSharing(false);
  };

  return (
    <div className="space-y-4">
      {/* ---- Section: Sinyal Terbaru ---- */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-zinc-100">
              Sinyal Terbaru
            </CardTitle>
            <Dialog open={shareOpen} onOpenChange={setShareOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Bagikan Sinyal Anda
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-800 sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-zinc-100">Bagikan Sinyal Anda</DialogTitle>
                </DialogHeader>
                <ShareSignalForm
                  formData={formData}
                  setFormData={setFormData}
                  isSharing={isSharing}
                  onSubmit={handleShare}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoadingSignals ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-40 bg-zinc-800" />
                  <Skeleton className="h-16 w-full bg-zinc-800" />
                  <Skeleton className="h-3 w-24 bg-zinc-800" />
                </div>
              ))}
            </div>
          ) : signalError ? (
            <div className="py-6 text-center">
              <p className="text-sm text-red-400">{signalError}</p>
              <Button variant="ghost" size="sm" onClick={fetchSignals} className="mt-2 text-zinc-400 hover:text-zinc-200">
                Coba Lagi
              </Button>
            </div>
          ) : signals.length === 0 ? (
            <div className="py-6 text-center">
              <Share2 className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">Belum ada sinyal yang dibagikan</p>
              <p className="text-xs text-zinc-600 mt-1">Jadilah yang pertama membagikan sinyal!</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[500px] overflow-y-auto">
              <div className="space-y-3">
                {signals.map(signal => (
                  <SignalCard
                    key={signal.id}
                    signal={signal}
                    isLiking={likingId === signal.id}
                    isCommentsExpanded={expandedComments.has(signal.id)}
                    comments={comments[signal.id] ?? []}
                    isLoadingComments={!!isLoadingComments[signal.id]}
                    commentText={commentText[signal.id] ?? ''}
                    isPostingComment={isPostingComment === signal.id}
                    onLike={() => handleLike(signal.id)}
                    onToggleComments={() => toggleComments(signal.id)}
                    onCommentTextChange={(text) => setCommentText(prev => ({ ...prev, [signal.id]: text }))}
                    onPostComment={() => handlePostComment(signal.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Sub-component: Signal Card
// ============================================================

interface SignalCardProps {
  signal: SharedSignal;
  isLiking: boolean;
  isCommentsExpanded: boolean;
  comments: SignalComment[];
  isLoadingComments: boolean;
  commentText: string;
  isPostingComment: boolean;
  onLike: () => void;
  onToggleComments: () => void;
  onCommentTextChange: (_text: string) => void;
  onPostComment: () => void;
}

function SignalCard({
  signal,
  isLiking,
  isCommentsExpanded,
  comments,
  isLoadingComments,
  commentText,
  isPostingComment,
  onLike,
  onToggleComments,
  onCommentTextChange,
  onPostComment,
}: SignalCardProps) {
  const isBuy = signal.direction === 'BUY';
  const confidence = Math.min(100, Math.max(0, signal.confidence));

  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 space-y-2">
      {/* Header: pair + direction + time */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100">
            {EXTENDED_PAIR_DISPLAY[signal.pair] || signal.pair}
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${
              isBuy
                ? 'border-emerald-600/40 text-emerald-400'
                : 'border-red-600/40 text-red-400'
            }`}
          >
            {isBuy ? (
              <TrendingUp className="h-3 w-3 mr-0.5" />
            ) : (
              <TrendingDown className="h-3 w-3 mr-0.5" />
            )}
            {signal.direction}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <Clock className="h-3 w-3" />
          <span className="text-[10px]">{timeAgo(signal.createdAt)}</span>
        </div>
      </div>

      {/* Price levels */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-zinc-900/60 rounded px-2 py-1.5">
          <p className="text-[10px] text-zinc-500">Entry</p>
          <p className="text-xs font-mono text-zinc-200">{fmtPrice(signal.pair, signal.entry)}</p>
        </div>
        <div className="bg-zinc-900/60 rounded px-2 py-1.5">
          <p className="text-[10px] text-red-500">Stop Loss</p>
          <p className="text-xs font-mono text-red-400">{fmtPrice(signal.pair, signal.stopLoss)}</p>
        </div>
        <div className="bg-zinc-900/60 rounded px-2 py-1.5">
          <p className="text-[10px] text-emerald-500">Take Profit</p>
          <p className="text-xs font-mono text-emerald-400">{fmtPrice(signal.pair, signal.takeProfit)}</p>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Keyakinan</span>
          <span className={`text-xs font-mono font-medium ${confidenceColor(confidence)}`}>
            {confidence}%
          </span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${confidenceBarColor(confidence)}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* Reasoning (truncated) */}
      {signal.reasoning && (
        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">
          {signal.reasoning}
        </p>
      )}

      {/* Strategy + user info */}
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          {signal.strategy
            ? (STRATEGY_LABELS[signal.strategy as StrategyName] ?? signal.strategy)
            : 'Manual'}
        </span>
        <span>{signal.userName}</span>
      </div>

      {/* Actions: like + comment */}
      <Separator className="bg-zinc-700/50" />
      <div className="flex items-center gap-3">
        <button
          onClick={onLike}
          disabled={isLiking}
          className="flex items-center gap-1 text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-50"
        >
          <Heart className={`h-3.5 w-3.5 ${signal.isLiked ? 'fill-red-400 text-red-400' : ''}`} />
          <span className="text-xs">{signal.likes > 0 ? signal.likes : ''}</span>
        </button>
        <button
          onClick={onToggleComments}
          className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          <span className="text-xs">{signal.commentCount > 0 ? signal.commentCount : ''}</span>
          {isCommentsExpanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Expanded comments */}
      {isCommentsExpanded && (
        <div className="space-y-2 pt-1 border-t border-zinc-700/50">
          {isLoadingComments ? (
            <div className="py-2">
              <Skeleton className="h-6 w-full bg-zinc-800 mb-1" />
              <Skeleton className="h-6 w-3/4 bg-zinc-800" />
            </div>
          ) : comments.length > 0 ? (
            <ScrollArea className="max-h-40 overflow-y-auto">
              <div className="space-y-2">
                {comments.map(c => (
                  <div key={c.id} className="bg-zinc-900/50 rounded px-2.5 py-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] font-medium text-zinc-300">{c.userName}</span>
                      <span className="text-[9px] text-zinc-600">{timeAgo(c.createdAt)}</span>
                    </div>
                    <p className="text-xs text-zinc-400">{c.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-[10px] text-zinc-600 py-2 text-center">Belum ada komentar</p>
          )}

          {/* Post comment input */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Tulis komentar..."
              value={commentText}
              onChange={(e) => onCommentTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onPostComment();
                }
              }}
              className="h-7 text-xs bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-600"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
              onClick={onPostComment}
              disabled={!commentText.trim() || isPostingComment}
            >
              {isPostingComment ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-component: Share Signal Form
// ============================================================

interface ShareFormProps {
  formData: ShareFormData;
  setFormData: React.Dispatch<React.SetStateAction<ShareFormData>>;
  isSharing: boolean;
  onSubmit: () => void;
}

function ShareSignalForm({ formData, setFormData, isSharing, onSubmit }: ShareFormProps) {
  const update = (field: keyof ShareFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-4">
      {/* Pair & Direction */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Pair</Label>
          <Select value={formData.pair} onValueChange={(v) => update('pair', v)}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              {EXTENDED_PAIRS.map(p => (
                <SelectItem key={p} value={p} className="text-zinc-200 focus:bg-zinc-700 focus:text-zinc-100">
                  {EXTENDED_PAIR_DISPLAY[p]} <span className="text-zinc-500 ml-1">({p})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Arah</Label>
          <Select value={formData.direction} onValueChange={(v) => update('direction', v)}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="BUY" className="text-emerald-400 focus:bg-zinc-700">BUY</SelectItem>
              <SelectItem value="SELL" className="text-red-400 focus:bg-zinc-700">SELL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Entry</Label>
          <Input
            type="number"
            step="any"
            placeholder="0.00000"
            value={formData.entry}
            onChange={(e) => update('entry', e.target.value)}
            className="bg-zinc-800 border-zinc-700 text-zinc-200 font-mono text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Stop Loss</Label>
          <Input
            type="number"
            step="any"
            placeholder="0.00000"
            value={formData.stopLoss}
            onChange={(e) => update('stopLoss', e.target.value)}
            className="bg-zinc-800 border-zinc-700 text-zinc-200 font-mono text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Take Profit</Label>
          <Input
            type="number"
            step="any"
            placeholder="0.00000"
            value={formData.takeProfit}
            onChange={(e) => update('takeProfit', e.target.value)}
            className="bg-zinc-800 border-zinc-700 text-zinc-200 font-mono text-sm"
          />
        </div>
      </div>

      {/* Confidence slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-zinc-400">Keyakinan</Label>
          <span className={`text-xs font-mono font-medium ${confidenceColor(formData.confidence)}`}>
            {formData.confidence}%
          </span>
        </div>
        <Progress value={formData.confidence} className="h-2 bg-zinc-800" />
        <div className="flex items-center justify-between">
          <button
            onClick={() => update('confidence', 10)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >10%</button>
          <button
            onClick={() => update('confidence', 50)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >50%</button>
          <button
            onClick={() => update('confidence', 75)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >75%</button>
          <button
            onClick={() => update('confidence', 100)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >100%</button>
        </div>
      </div>

      {/* Strategy */}
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">Strategi</Label>
        <Select value={formData.strategy} onValueChange={(v) => update('strategy', v)}>
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700 max-h-48">
            {Object.entries(STRATEGY_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key} className="text-zinc-200 focus:bg-zinc-700 focus:text-zinc-100">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reasoning */}
      <div className="space-y-1.5">
        <Label className="text-xs text-zinc-400">Alasan Analisis</Label>
        <Textarea
          placeholder="Jelaskan alasan Anda membuka sinyal ini..."
          value={formData.reasoning}
          onChange={(e) => update('reasoning', e.target.value)}
          rows={3}
          className="bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-600 text-sm resize-none"
        />
      </div>

      {/* Submit */}
      <Button
        onClick={onSubmit}
        disabled={isSharing}
        className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
      >
        {isSharing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Bagikan Sinyal
      </Button>
    </div>
  );
}
