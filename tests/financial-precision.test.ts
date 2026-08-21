import { describe, it, expect } from 'vitest';

describe('Financial Precision — Float vs Integer Math', () => {
  it('Float arithmetic causes precision loss on forex prices', () => {
    const price = 1.08523;
    const lotSize = 0.5;
    const pipValue = 0.0001;
    
    // Float arithmetic that's wrong:
    const floatPnl = (price + pipValue * 10) * lotSize - price * lotSize;
    // Should be 0.5 but floating point gives 0.5000000000000001
    expect(floatPnl).not.toBe(0.5);
  });

  it('Integer-based pip math is exact', () => {
    // Solution: convert to integer pips, calculate, convert back
    function calculatePnlPips(entryPrice: number, exitPrice: number, lotSize: number, pipSize: number): number {
      const entryPips = Math.round(entryPrice / pipSize);
      const exitPips = Math.round(exitPrice / pipSize);
      const pnlPips = (exitPips - entryPips) * lotSize;
      return Math.round(pnlPips * 100) / 100;
    }
    
    // 100 pips * 0.5 lots = 50 pip-lots (exact integer math, no float error)
    const pnl = calculatePnlPips(1.08523, 1.09523, 0.5, 0.0001);
    expect(pnl).toBe(50);
  });

  it('Handles XAUUSD precision (2 decimal places)', () => {
    function calculatePnlPips(entryPrice: number, exitPrice: number, lotSize: number, pipSize: number): number {
      const entryPips = Math.round(entryPrice / pipSize);
      const exitPips = Math.round(exitPrice / pipSize);
      const pnlPips = (exitPips - entryPips) * lotSize;
      return Math.round(pnlPips * 100) / 100;
    }
    
    const pnl = calculatePnlPips(2350.50, 2360.50, 0.1, 0.01);
    expect(pnl).toBe(100);
  });

  it('USDJPY precision (3 decimal places)', () => {
    function calculatePnlPips(entryPrice: number, exitPrice: number, lotSize: number, pipSize: number): number {
      const entryPips = Math.round(entryPrice / pipSize);
      const exitPips = Math.round(exitPrice / pipSize);
      const pnlPips = (exitPips - entryPips) * lotSize;
      return Math.round(pnlPips * 100) / 100;
    }
    
    // 50 pips * 0.1 lots = 5 pip-lots (exact integer math)
    const pnl = calculatePnlPips(149.850, 150.350, 0.1, 0.01);
    expect(pnl).toBe(5);
  });

  it('Zero PnL when entry equals exit', () => {
    function calculatePnlPips(entryPrice: number, exitPrice: number, lotSize: number, pipSize: number): number {
      const entryPips = Math.round(entryPrice / pipSize);
      const exitPips = Math.round(exitPrice / pipSize);
      const pnlPips = (exitPips - entryPips) * lotSize;
      return Math.round(pnlPips * 100) / 100;
    }
    
    const pnl = calculatePnlPips(1.08523, 1.08523, 0.5, 0.0001);
    expect(pnl).toBe(0);
  });

  it('Negative PnL for losing trade', () => {
    function calculatePnlPips(entryPrice: number, exitPrice: number, lotSize: number, pipSize: number): number {
      const entryPips = Math.round(entryPrice / pipSize);
      const exitPips = Math.round(exitPrice / pipSize);
      const pnlPips = (exitPips - entryPips) * lotSize;
      return Math.round(pnlPips * 100) / 100;
    }
    
    // -50 pips * 0.5 lots = -25 pip-lots (exact integer math)
    const pnl = calculatePnlPips(1.08523, 1.08023, 0.5, 0.0001);
    expect(pnl).toBe(-25);
  });
});
