// Centralized configuration constants for the trading system

export const BASE_BALANCE = Number(process.env.BASE_BALANCE) || 10000
export const LEVERAGE = 25 // FINEX Indonesia leverage 1:25
export const COMMISSION_PER_LOT = 1 // FINEX Indonesia commission $1/lot
export const PIP_VALUE_PER_LOT = 100_000 // Pip value per standard lot

// NOTE: getCurrentEquity() should be added here or in a shared service once
//       db is imported. It would compute: BASE_BALANCE + aggregate(sum of pnl
//       for all trades with status in ['OPEN','CLOSED','PARTIAL_FILLED'])
