# FINEX Indonesia — Scalability Guide

## Current Architecture

- **Database**: SQLite via Prisma ORM (single-file, zero-config)
- **Runtime**: Next.js 16 (Node.js) + Bun mini-services
- **Real-time**: WebSocket (port 3005) + HTTP polling fallback
- **Caching**: In-memory (Zustand client, API route-level)
- **Deployment**: Docker Compose + Caddy reverse proxy

## SQLite Limitations

| Aspect | SQLite | PostgreSQL |
|--------|--------|------------|
| Concurrent writes | Single writer | Multiple writers |
| Horizontal scaling | Not possible | Read replicas, sharding |
| Connection pooling | N/A (embedded) | PgBouncer, built-in |
| Full-text search | Limited (FTS5) | Advanced (tsvector) |
| JSON operations | Basic | JSONB with indexing |
| Max DB size | 280 TB (theoretical) | Unlimited |
| Production ready | Single instance | Distributed systems |

## When to Migrate to PostgreSQL

Consider migration when:
- **Multiple server instances** are needed (load balancing)
- **Concurrent write load** exceeds SQLite's single-writer limit
- **Real-time multi-user** trading requires sub-millisecond DB response
- **Regulatory compliance** demands audit trails with guaranteed durability
- **Data retention** exceeds 50GB (BAPPEBTI requires 5-year trade history)

## Migration Steps

### 1. Install PostgreSQL Adapter

```bash
bun add @prisma/adapter-pg pg
```

### 2. Update DATABASE_URL

```env
# .env
DATABASE_URL="postgresql://user:password@localhost:5432/finex_indonesia"
```

### 3. Update Prisma Schema

Change the datasource in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 4. Run Migration

```bash
bunx prisma migrate dev --name migrate_to_postgresql
bunx prisma generate
```

### 5. Add Connection Pooling

Update `src/lib/db.ts` to use connection pooling:

```typescript
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const adapter = new PrismaPg(pool);
export const db = new PrismaClient({ adapter });
```

### 6. Update docker-compose.yml

Add a PostgreSQL service:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: finex_indonesia
      POSTGRES_USER: finex
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finex"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

## Performance Optimization (Current Stack)

Before migrating, these optimizations can extend SQLite's capacity:

1. **WAL Mode**: `PRAGMA journal_mode=WAL;` (already default in better-sqlite3)
2. **Connection pooling**: Already using Prisma singleton
3. **Read replicas**: SQLite supports read-only replicas via replication
4. **Query optimization**: Add indexes on hot paths (pair + status, timestamps)
5. **Batch operations**: Use `createMany` instead of individual creates
6. **Data archiving**: Move old closed positions to archive table

## BAPPEBTI Compliance Notes

- **5-year trade history**: Plan for ~500K records/year (4 pairs × ~50 trades/day × 250 days)
- **Audit trail**: ActivityLog table grows fast — consider partitioning by month
- **Data integrity**: SQLite ACID compliance is sufficient for single-instance
- **Backup**: Automated daily backup of SQLite file + WAL
