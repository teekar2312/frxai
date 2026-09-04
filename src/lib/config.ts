// Centralized configuration constants for the trading system.
// Pure static configuration only — dynamic/database-backed values live in
// the domain modules (e.g. money-management, risk-engine).

export const BASE_BALANCE = Number(process.env.BASE_BALANCE) || 10000
export const LEVERAGE = 25 // FINEX Indonesia leverage 1:25
export const COMMISSION_PER_LOT = 1 // FINEX Indonesia commission $1/lot
export const PIP_VALUE_PER_LOT = 100_000 // Pip value per standard lot
