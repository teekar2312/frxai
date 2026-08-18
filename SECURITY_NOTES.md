# Security Notes — FINEX Indonesia

## Database Encryption (SQLite)

The application uses SQLite for data storage. While suitable for single-instance deployments, **SQLite does not encrypt data at rest by default**.

### Current Mitigations
- Database file is stored in a Docker named volume (`finex-data`)
- Container runs as non-root user (`nextjs:nodejs`, UID 1001)
- File permissions are managed by the container runtime

### Recommendations for Production
1. **Filesystem encryption**: Use LUKS or filesystem-level encryption on the host
2. **Application-level encryption**: Encrypt sensitive fields (PnL, account balance) before storage
3. **Database migration**: For multi-instance or high-security setups, migrate to PostgreSQL
4. **Volume backup encryption**: Ensure backups are encrypted at rest

## Rate Limiting

Rate limiting is implemented in-memory using a sliding window algorithm.

### Limitations
- **Single instance**: Rate limits work correctly
- **Multi-instance**: Each instance maintains its own counter; limits are per-instance
- **Server restart**: All rate limit counters reset

### Recommendation for Scaling
For multi-instance deployments, implement Redis-backed distributed rate limiting. Current implementation is sufficient for single-instance.

## Session Management

- Session tokens are JWT-based with 8-hour expiration
- Tokens are stored in HTTP-only cookies
- `NEXTAUTH_SECRET` must be set to a strong random value (32+ bytes) in production
- Generate with: `openssl rand -hex 32`

## Content Security Policy

In production, CSP removes `unsafe-eval` from `script-src`:
- Prevents dynamic code evaluation (`eval`, `Function` constructor)
- `unsafe-inline` retained for styles (required by Tailwind CSS runtime injection)

## Authentication

- NextAuth.js v4 with Credentials provider
- Passwords hashed with bcryptjs (12 salt rounds)
- All API routes require valid session (except `/api/auth/*` and `/api/health`)
- Default admin user seeded on first setup — change the password immediately