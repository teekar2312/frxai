const fs = require('fs');
const c = fs.readFileSync('src/components/trading/RiskManagementPanel.tsx', 'utf8');

// G3-1: Add Brain import
let r = c.replace(
  import { Crosshair, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
  import { Crosshair, CheckCircle2, AlertTriangle, Loader2, Brain } from 'lucide-react';
);

// G3-2: Add store fields
r = r.replace(
  const { accountBalance, todayRiskUsed } = useTradingStore();
  const { accountBalance, todayRiskUsed, selectedPair, aiAnalysis } = useTradingStore();
);

// G3-3: Insert AI card before Money management
const aiCard = '
      {/* AUDIT-AI-G3: AI Analysis Recommendation */
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Brain className="w-4 h-4 text-emerald-400" /> AI Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {aiAnalysis[selectedPair] ? (
              <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Recommendation</span>
                  <span className={aiAnalysis[selectedPair].recommendation === "BUY" ? "text-emerald-400" : aiAnalysis[selectedPair].recommendation === "SELL" ? "text-rose-400" : "text-zinc-400"}>{aiAnalysis[selectedPair].recommendation}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Confidence</span>
                  <span className="text-zinc-200 font-mono">{(aiAnalysis[selectedPair].confidence * 100).toFixed(0)}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Risk Level</span>
                  <span className={aiAnalysis[selectedPair].riskLevel === "low" ? "text-emerald-400" : aiAnalysis[selectedPair].riskLevel === "high" ? "text-rose-400" : "text-amber-400"}>{aiAnalysis[selectedPair].riskLevel}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Market</span>
                  <span className="text-zinc-300">{MARKET_CONDITION_LABELS[aiAnalysis[selectedPair].marketCondition]}</span>
                </div>
                {(aiAnalysis[selectedPair].entryPrice || aiAnalysis[selectedPair].stopLoss || aiAnalysis[selectedPair].takeProfit) && (
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {aiAnalysis[selectedPair].entryPrice ? <div className="bg-zinc-800/50 rounded p-1.5 text-center"><p className="text-[9px] text-zinc-500">Entry</p><p className="text-[11px] text-white font-mono">{aiAnalysis[selectedPair].entryPrice}</p></div> : null}
                    {aiAnalysis[selectedPair].stopLoss ? <div className="bg-zinc-800/50 rounded p-1.5 text-center"><p className="text-[9px] text-zinc-500">SL</p><p className="text-[11px] text-rose-400 font-mono">{aiAnalysis[selectedPair].stopLoss}</p></div> : null}
                    {aiAnalysis[selectedPair].takeProfit ? <div className="bg-zinc-800/50 rounded p-1.5 text-center"><p className="text-[9px] text-zinc-500">TP</p><p className="text-[11px] text-emerald-400 font-mono">{aiAnalysis[selectedPair].takeProfit}</p></div> : null}
                  </div>
                )}
                <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed line-clamp-3">{aiAnalysis[selectedPair].reasoning}</p>
              </div>
            ) : (
              <div className="text-center py-6">
                <Brain className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No AI analysis for {PAIR_DISPLAY[selectedPair]} yet.</p>
                <p className="text-[10px] text-zinc-600">Run analysis in the AI Analysis tab first.</p>
              </div>
            )}
          </CardContent>
        </Card>
';

r = r.replace('      {/* Money management rules', aiCard + '      {/* Money management rules', 1);

// G3-4: Add MARKET_CONDITION_LABELS import (already has PAIR_DISPLAY, STRATEGY_LABELS)
r = r.replace(/MARKET_CONDITION_LABELS,/, 'MARKET_CONDITION_LABELS,');

fs.writeFileSync('src/components/trading/RiskManagementPanel.tsx', r);
console.log('G3 done, lines:', r.split('\n').length);
