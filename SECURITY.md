This document describes the security architecture, policies, and procedures for FINEX Indonesia v2.3.0, an AI-powered forex trading dashboard. It is intended for system administrators, security reviewers, and contributors who need to understand how the application protects user data, enforces access control, and meets regulatory obligations under BAPPEBTI. This document should be reviewed and updated with every release that modifies authentication, API surface, or infrastructure configuration.

---

## Table of Contents

- [Security Architecture Overview](#security-architecture-overview)
- [Layer 1: Infrastructure Security (Caddy)](#layer-1-infrastructure-security-caddy)
- [Layer 2: Application Security (Next.js Middleware)](#layer-2-application-security-nextjs-middleware)
- [Layer 3: Authentication and Session Management](#layer-3-authentication-and-session-management)
- [Layer 4: API Protection](#layer-4-api-protection)
- [Layer 5: Trading Safety Controls](#layer-5-trading-safety-controls)
- [Data Protection](#data-protection)
- [Regulatory Compliance (BAPPEBTI)](#regulatory-compliance-bappebti)
- [Known Limitations and Accepted Risks](#known-limitations-and-accepted-risks)
- [Security Response Policy](#security-response-policy)
- [Reporting Vulnerabilities](#reporting-vulnerabilities)
- [Deployment Security Checklist](#deployment-security-checklist)
- [Version History](#version-history)

---

## Security Architecture Overview

FINEX Indonesia employs a defense-in-depth strategy with five distinct security layers. Each layer provides independent protections so that a compromise in one layer does not fully compromise the system. The layers are ordered from outermost (network-facing) to innermost (business logic) and are summarized below.

| Layer | Component | Primary Responsibility |
|-------|-----------|----------------------|
| 1 | Caddy Reverse Proxy | TLS termination, rate limiting, security headers |
| 2 | Next.js Middleware | Route authentication, redundant headers, CSP enforcement |
| 3 | NextAuth.js + JWT | Identity verification, session management, 2FA |
| 4 | API Layer | Rate limiting, input validation, SQL injection prevention |
| 5 | Trading Engine | Position limits, risk caps, news avoidance, margin controls |

---

## Layer 1: Infrastructure Security (Caddy)

Caddy serves as the edge reverse proxy and is responsible for all network-facing security controls.

### TLS Configuration

- **Protocol**: TLS 1.3 enforced; older protocol versions are rejected.
- **Certificate Authority**: Let's Encrypt with automatic renewal.
- **HTTP/3**: Enabled on port 443/UDP for improved performance and reduced latency.

### Rate Limiting

Rate limits are enforced at the Caddy level to absorb volumetric attacks before they reach the application.

| Scope | Limit |
|-------|-------|
| Global (all requests) | 200 requests/second |
| API routes | 30 requests/second |
| Authentication endpoints | 5 requests per 60 seconds |

### Security Headers

The following security headers are applied by Caddy on every response:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Server` header is suppressed to hide identity.

### Content Security Policy

Caddy applies the following Content-Security-Policy at the infrastructure level:

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' https: wss:;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

---

## Layer 2: Application Security (Next.js Middleware)

Next.js middleware provides a second enforcement point for security controls, ensuring that protections remain in effect even if the proxy configuration is modified.

### Authentication Guard

All routes except the following public paths require an active, authenticated session:

- `/api/auth`
- `/api/health`
- `/login`
- `/register`
- `/manifest.json`
- `/forgot-password`
- `/reset-password`
- `/legal`

Unauthenticated requests to protected routes receive a 302 redirect to `/login`.

### Redundant Security Headers

Security headers are reapplied at the middleware level. This ensures coverage for any request path that bypasses Caddy (e.g., in development or misconfigured environments).

### Production CSP Hardening

In production, the middleware CSP removes `'unsafe-eval'` from `script-src` and restricts `connect-src` to HTTPS and WSS only.

---

## Layer 3: Authentication and Session Management

Authentication is handled by NextAuth.js v4 using the credentials provider with a JWT strategy.

### Password Storage

- Hashing algorithm: bcryptjs with 10 salt rounds (default).
- Plaintext passwords are never logged, stored, or transmitted after hashing.

### Session Configuration

- Strategy: JWT signed with `NEXTAUTH_SECRET`.
- Maximum session age: 8 hours.
- JWT payload includes a `twoFactorVerified` flag to enforce two-factor authentication state.

### Two-Factor Authentication (2FA/TOTP)

- Implemented using the `otplib` library.
- When 2FA is enabled for an account, the login flow requires a valid TOTP code after credential verification.
- The session JWT is only issued after successful TOTP verification.
- Users can enable, disable, and regenerate TOTP secrets from their account settings.

### Service-to-Service Authentication

- Mutations in production require an `API_SECRET_KEY` header.
- Comparison is performed using `crypto.timingSafeEqual` to prevent timing attacks.
- If `API_SECRET_KEY` is not configured in production, all mutation endpoints return HTTP 503.
- No hardcoded fallback keys exist in the codebase.

---

## Layer 4: API Protection

### Rate Limiting (Application Level)

An in-memory sliding window rate limiter applies per-endpoint-category limits. These complement the Caddy-level limits and provide finer granularity.

| Endpoint Category | Limit |
|------------------|-------|
| Authentication | 10 requests/minute |
| Trade operations | 10 requests/minute |
| AI analysis | 5 requests/minute |
| Finnhub data | 12 requests/minute |
| News feeds | 3 requests/minute |
| General API | 60 requests/minute |

### Access Control Model

- **Read operations**: Require a valid user session (JWT).
- **Write operations**: Require both a valid session and the `API_SECRET_KEY` header.

### Input Validation

All API inputs are validated against Zod schemas before processing. Invalid input receives a 400 response with descriptive error messages that do not leak internal details.

### SQL Injection Prevention

All database queries are executed through Prisma ORM, which uses parameterized queries exclusively. Raw SQL is not used anywhere in the application.

---

## Layer 5: Trading Safety Controls

Trading controls enforce risk management rules at the application layer before any order is submitted to the broker.

### Position Limits

- Maximum open positions: 3 (configurable).
- Pending orders are subject to the same position limit check before creation.

### Risk Management

- Daily risk limit: 2.5% of account balance (configurable).
- Margin call level: 50%.
- Stop-out level: 20%.

### News-Aware Trading

When `avoidNewsTrading` is enabled:

- New positions are blocked within 30 minutes before and after high-impact economic news events.
- Pending order creation is also blocked during the news window.

### Order Execution Safety

- Spread is validated against a maximum threshold before order execution.
- Stop-loss and take-profit levels are calculated using bid/ask prices, not mid-price, to ensure accurate trigger levels.
- Pending orders undergo full safety checks: max positions, news avoidance, and spread-adjusted pricing.

---

## Data Protection

### Secrets Management

- All secrets are stored in environment variables (`.env` file).
- The `.env` file is excluded from version control via `.gitignore`.
- Secrets are never committed to the repository.

### Data at Rest

| Data Type | Protection |
|-----------|-----------|
| Passwords | bcryptjs hash (10 rounds) |
| TOTP secrets | Stored in database (encryption at rest recommended for future) |
| Session tokens | JWT signed with `NEXTAUTH_SECRET`, 8-hour expiry |
| Database | SQLite file (unencrypted; SQLCipher recommended for future) |

### Logging

- Production logs are processed through a `safe-log.ts` utility that:
  - Sanitizes file paths to prevent directory traversal disclosure.
  - Truncates error messages to prevent sensitive data leakage.
  - Redacts any detected secret patterns.

---

## Regulatory Compliance (BAPPEBTI)

FINEX Indonesia is designed to operate within the regulatory framework established by BAPPEBTI (Badan Pengawas Perdagangan Berjangka Komoditi) for retail forex trading in Indonesia.

### Leverage Restrictions

- Maximum leverage is capped at 1:100, which is the BAPPEBTI limit for retail traders.
- This limit is enforced at the application level and cannot be overridden by user configuration.

### Mandatory Disclosures

The following disclosures are required and enforced within the application:

- **Risk disclosure banner**: Displayed on all application pages.
- **Risk disclosure page**: Full legal text available at `/legal/risk-disclosure`.
- **Terms of service**: Available at `/legal/terms`.
- **Privacy policy**: Available at `/legal/privacy`.
- **Fund segregation disclosure**: Included in the risk disclosure documentation.
- **AI analysis disclaimer**: Attached to all AI-generated analysis content, making clear that predictions are not guarantees.

### Registration Control

- `ALLOW_REGISTRATION` is set to `false` by default.
- New account creation must be explicitly enabled by an administrator.

---

## Known Limitations and Accepted Risks

The following limitations are acknowledged and accepted within the current threat model, which assumes a single-instance deployment with a trusted host environment.

### Database Encryption

The SQLite database file is not encrypted at rest. This is acceptable for single-instance deployments where the host filesystem is trusted. For multi-tenant or untrusted-host deployments, migration to SQLCipher is recommended.

### In-Memory Rate Limiter

The application-level rate limiter stores counters in process memory. Rate limit state is lost on application restart. This is acceptable because Caddy provides persistent rate limiting at the infrastructure layer.

### CSRF Protection

No explicit CSRF token mechanism is implemented. This is mitigated by:

- `SameSite` cookie attributes on session tokens.
- API key authentication for all mutation endpoints.
- `Content-Security-Policy` restricting form actions to `'self'`.

### Admin Route Protection

No IP allowlisting is applied to administrative routes. Access control relies solely on session authentication. For environments requiring stricter admin access, network-level controls (e.g., VPN, firewall rules) should be applied.

### Audit Log Growth

Audit logs grow indefinitely without rotation. For long-running production deployments, a log rotation strategy (e.g., size-based or time-based rotation with archival) should be implemented.

---

## Security Response Policy

### Severity Classification

| Severity | Definition | Target Response Time |
|----------|-----------|---------------------|
| Critical | Active exploitation, data breach, or remote code execution | 24 hours |
| High | Authentication bypass, privilege escalation, or significant data exposure | 48 hours |
| Medium | Limited information disclosure or non-critical vulnerability | 7 days |
| Low | Minor information leakage, best-practice deviation | Next release |

### Response Process

1. **Acknowledgment**: The reporter receives confirmation within 48 hours of a responsible disclosure.
2. **Assessment**: The team triages the report, determines severity, and identifies affected components.
3. **Remediation**: A fix is developed and tested. The timeline depends on severity (see table above).
4. **Disclosure**: The reporter is notified when the fix is released. Public disclosure is coordinated to avoid exposing users to unpatched vulnerabilities.

---

## Reporting Vulnerabilities

Security is taken seriously by the FINEX Indonesia team. If you discover a vulnerability, please report it responsibly.

### How to Report

1. **Preferred method**: Create a GitHub issue with the title prefixed with `[SECURITY]` and set the issue visibility to **Private**.
2. **Alternative method**: Contact the repository maintainer directly via email.

### What to Include

- A clear description of the vulnerability.
- Steps to reproduce the issue.
- The affected component or endpoint.
- Potential impact if the vulnerability is exploited.
- Any suggested fix, if available.

### What to Avoid

- Do NOT open a public issue for security vulnerabilities.
- Do NOT disclose the vulnerability to third parties before coordinated disclosure.
- Do NOT attempt to access or exfiltrate real user data to demonstrate the vulnerability.

---

## Deployment Security Checklist

Complete the following checklist before deploying FINEX Indonesia to a production environment.

### Secrets

- [ ] Generate a fresh `NEXTAUTH_SECRET`:
  ```bash
  openssl rand -hex 32
  ```
- [ ] Generate a fresh `API_SECRET_KEY`:
  ```bash
  openssl rand -hex 32
  ```
- [ ] Verify that secrets are set in environment variables, not in source code.
- [ ] Confirm that `.env` is listed in `.gitignore` and is not tracked.

### Access Control

- [ ] Set `ALLOW_REGISTRATION=false` unless self-registration is explicitly required.
- [ ] Create the initial admin user account through a secure, controlled process.
- [ ] Review and restrict admin user access.

### TLS and Headers

- [ ] Configure Caddy with a valid domain name for automatic TLS certificate provisioning.
- [ ] Verify TLS 1.3 is negotiated:
  ```bash
  openssl s_client -connect example.com:443 -tls1_3
  ```
- [ ] Verify security headers are present and correct:
  ```bash
  curl -I https://example.com
  ```
  Expected headers: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`.

### Rate Limiting

- [ ] Test global rate limiting by sending rapid requests and verifying 429 responses.
- [ ] Test authentication endpoint rate limiting (5 requests per 60 seconds).
- [ ] Verify rate limit headers are returned in responses.

### Authentication

- [ ] Verify the login flow works with valid credentials.
- [ ] Verify that invalid credentials produce a generic error message (no user enumeration).
- [ ] Test 2FA setup, login with 2FA enabled, and 2FA disable flow.
- [ ] Verify the password reset flow end to end (request, email delivery, reset).
- [ ] Confirm that sessions expire after 8 hours of inactivity.

### Health and Information Disclosure

- [ ] Verify `/api/health` returns operational status without exposing sensitive data (no secrets, no stack traces, no internal IPs).
- [ ] Verify `robots.txt` blocks all crawling:
  ```
  User-agent: *
  Disallow: /
  ```
- [ ] Confirm the `Server` header is suppressed or generic.

### Database and Backups

- [ ] Set up automated database backups.
- [ ] Verify backup encryption if the backup storage is not fully trusted.
- [ ] Test database restoration from a backup.

### Logging

- [ ] Review environment variables to ensure no secrets appear in application logs.
- [ ] Verify that the `safe-log.ts` utility is active in production.
- [ ] Confirm log output does not contain file paths, stack traces, or secret values.

---

## Version History

| Version | Date | Changes |
|---------|------|--------|
| 2.3.0 | Current | Initial SECURITY.md; documented all five security layers, data protection measures, BAPPEBTI compliance controls, and deployment checklist. |

---

*This document is maintained by the FINEX Indonesia security team. For questions or clarifications, contact the repository maintainer.*
