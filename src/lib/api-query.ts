/**
 * Standardized parsing of pagination query parameters for API routes.
 *
 * Before this helper existed, each route hand-rolled its own variant:
 *   const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
 *   const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '20', 10) || 20))
 * ...with subtly different NaN/overflow handling per route. This module
 * gives every route the same contract:
 *   - missing / non-numeric / NaN        → default value
 *   - below 1                            → clamped to 1
 *   - above maxLimit (default 100)       → clamped to maxLimit
 *   - page/limit are integers; skip/take derived for Prisma findMany
 */

export interface Pagination {
  /** 1-based page number (>= 1) */
  page: number
  /** Page size (1..maxLimit) */
  limit: number
  /** (page - 1) * limit — Prisma `skip` */
  skip: number
  /** limit — Prisma `take` */
  take: number
}

export interface PaginationOptions {
  /** Default page when missing/invalid (default 1) */
  page?: number
  /** Default page size when missing/invalid (default 20) */
  limit?: number
  /** Upper bound for limit (default 100) */
  maxLimit?: number
}

function parseBoundedInt(
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = parseInt(raw ?? '', 10)
  const value = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(Math.max(value, min), max)
}

/**
 * Parse `page` and `limit` from a URLSearchParams (or any accessor with
 * the same `.get(name)` signature, e.g. NextURL).
 *
 * @example
 *   const { page, limit, skip, take } = parsePagination(searchParams, { limit: 50, maxLimit: 200 })
 */
export function parsePagination<
  S extends { get(name: string): string | null },
>(searchParams: S, options: PaginationOptions = {}): Pagination {
  const defaultPage = Math.max(1, Math.floor(options.page ?? 1))
  const defaultLimit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? 20), Math.floor(options.maxLimit ?? 100)),
  )
  const maxLimit = Math.max(1, Math.floor(options.maxLimit ?? 100))

  const page = parseBoundedInt(searchParams.get('page'), defaultPage, 1, Number.MAX_SAFE_INTEGER)
  const limit = parseBoundedInt(searchParams.get('limit'), defaultLimit, 1, maxLimit)

  return { page, limit, skip: (page - 1) * limit, take: limit }
}
