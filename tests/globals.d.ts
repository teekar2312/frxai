/**
 * Ambient type loading for Bun's global/test APIs.
 *
 * The repo's tsconfig includes tests/ but does not load bun-types by
 * default (the Next.js app targets the browser/node runtime, not Bun).
 * Without this reference, `import { describe, test, expect } from
 * "bun:test"` fails to resolve under `tsc --noEmit` even though
 * `bun test` executes fine.
 *
 * bun-types ships as a devDependency; loading it here makes the whole
 * test suite type-check without changing any test code.
 */
/// <reference types="bun-types" />
