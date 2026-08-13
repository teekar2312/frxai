# Security Considerations

## Platform-Controlled Limitations

The following items are managed by the hosting platform (Caddy reverse proxy) and cannot be modified at the application level:

### C-3: XTransformPort SSRF Risk
The `XTransformPort` query parameter in the Caddy configuration allows proxying to any local port. This is a platform feature for microservice routing. **Mitigation**: Restrict to an explicit port allowlist in the Caddyfile before production deployment.

### H-8: Missing Security Headers
Security headers (CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy) should be configured in the Caddyfile:
```caddy
header {
    X-Frame-Options "SAMEORIGIN"
    X-Content-Type-Options "nosniff"
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Referrer-Policy "strict-origin-when-cross-origin"
    Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
}
```

## Application-Level Security

### C-1: API Authentication
All mutating API endpoints (POST, PUT, PATCH, DELETE) require authentication when `API_SECRET_KEY` environment variable is set. Auth is disabled in development mode.

### H-1: Rate Limiting
In-memory sliding window rate limiter protects trade execution (10/min), AI analysis (5/min), and general endpoints (60/min).

### Design Limitations (Accepted)

### L-2: Hardcoded Volatility Thresholds in `detectMarketCondition`
The ATR percentage thresholds (0.3% for high volatility, 0.05% for low volatility) in `src/lib/indicators.ts` are not pair-aware. XAUUSD naturally has much higher ATR than EURUSD. **Future**: Add pair-specific calibration data and use percentile-based detection.

### L-3: `pivotPoints` Returns Flat Object
Unlike all other indicator functions that return arrays for charting, `pivotPoints()` returns a single flat object `{ pp, r1, r2, s1, s2 }`. This limits its usability in backtesting and historical charting. **Future**: Refactor to return an array of pivot data points (one per session) for API consistency.

## Environment Variables
```env
API_SECRET_KEY=your-secret-key-here  # Required for production
MT5_BRIDGE_API_KEY=bridge-key-here   # Required for MT5 integration
FINNHUB_API_KEY=finnhub-key         # Required for live market data
MARKETAUX_API_KEY=marketaux-key     # Required for live news
```
