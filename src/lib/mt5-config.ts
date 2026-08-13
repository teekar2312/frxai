// Shared MT5 bridge configuration for API routes
// M5: Centralized bridge URL + API key config

export const MT5_BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:3004';
// C-2: No hardcoded fallback - MT5_BRIDGE_API_KEY must be set via environment
export const MT5_BRIDGE_API_KEY = process.env.MT5_BRIDGE_API_KEY || '';

/** Headers to include when proxying requests to the MT5 bridge */
export const BRIDGE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Bridge-API-Key': MT5_BRIDGE_API_KEY,
};
