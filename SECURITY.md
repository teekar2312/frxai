# Security Considerations — FINEX Indonesia

## Platform-Level Security (Caddy)

### C-3: XTransformPort SSRF Risk — RESOLVED
The Caddyfile now restricts `XTransformPort` to an explicit allowlist (ports 3000 and 3004 only). Arbitrary port proxying is blocked.

### H-8: Security Headers — RESOLVED
The following security headers are now configured in the Caddyfile:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 1; mode=block`

> **Note**: HSTS and CSP should be added when deploying with HTTPS (Caddy auto-TLS).

## Application-Level Security

### C-1: API Authentication
All mutating API endpoints (POST, PUT, PATCH, DELETE) require `API_SECRET_KEY` when set. In production mode, a warning is logged if the key is unset. All endpoints now have rate limiting.

### H-1: Rate Limiting — ENHANCED
In-memory sliding window rate limiter now covers ALL endpoints:
- **Trade**: 10/min (positions POST, MT5 orders POST)
- **Analysis**: 5/min (AI analysis, indicators POST)
- **General**: 60/min (all other mutating endpoints)

### S-8E-01: Structured Logging — RESOLVED
All API routes now use `logApiError()` from `safe-log.ts`. Zero raw `console.error()` calls remain in production code.

## MT5 Bridge Security

### M-05: Bridge API Key — RESOLVED
The MT5 bridge no longer has a hardcoded fallback API key. If `BRIDGE_API_KEY` is not set, bridge authentication is disabled with a startup warning.

### M-06: CORS Configuration — ENHANCED
Bridge CORS origins are now configurable via `ALLOWED_ORIGINS` environment variable (comma-separated).

## Design Limitations (Accepted)

### L-2: Hardcoded Volatility Thresholds in `detectMarketCondition`
The ATR percentage thresholds are not pair-aware. XAUUSD naturally has much higher ATR than EURUSD. **Future**: Add pair-specific calibration data.

### L-3: `pivotPoints` Returns Flat Object
Returns a single flat object instead of arrays for charting. **Future**: Refactor for API consistency.

### S-1E-02: Page-Level Authentication
The dashboard currently has no login page or session management. For production deployment, implement NextAuth.js with credential-based login, session cookies, and idle timeout.

### S-3E-01: Encryption at Rest
SQLite database is unencrypted. For production, consider SQLCipher or migrate to PostgreSQL with TLS.

## Regulatory Compliance — FINEX Indonesia

### BAPPEBTI
- Leverage default changed from 1:500 to 1:100 (compliant with BAPPEBTI retail limits)
- Risk disclosure banner displayed on every page view
- BAPPEBTI registration info shown in sidebar and settings
- Fund segregation (dana klien terpisah) disclosure present

### Risk Disclosure
- Persistent risk warning banner on all pages
- Full risk disclosure statement in Settings > Informasi Regulasi
- AI disclaimer on AI Analysis and Trading Signals panels

## Environment Variables
```env
API_SECRET_KEY=your-secret-key-here  # Required for production
MT5_BRIDGE_API_KEY=bridge-key-here   # Required for MT5 integration
FINNHUB_API_KEY=finnhub-key         # Required for live market data
MARKETAUX_API_KEY=marketaux-key     # Required for live news
ALLOWED_ORIGINS=https://your-domain.com  # CORS for MT5 bridge
```
