Thank you for your interest in contributing to FINEX Indonesia. This document provides the guidelines and conventions you need to follow when working on this project. FINEX Indonesia is a professional trading terminal built with Next.js, designed for the Indonesian market with multi-language support, real-time price streaming, AI-powered analysis, and MT5 integration. Whether you are fixing a bug, adding a new indicator, or improving documentation, your contributions are valued. Please read this guide in full before submitting your first pull request.

## Getting Started

Before you begin contributing, ensure you have the following tools installed and configured on your system:

- **Bun 1.x** — The JavaScript runtime and package manager used by this project. Install it from https://bun.sh if you do not already have it.
- **Git** — Version control. You should have a working installation with your identity configured.
- **GitHub account** — Required for opening issues, forking the repository, and submitting pull requests.

## Development Setup

Follow these steps to get the project running locally:

1. Fork the repository and clone your fork:
   ```
   git clone https://github.com/<your-username>/finex-indonesia.git
   cd finex-indonesia
   ```
2. Install dependencies:
   ```
   bun install
   ```
3. Set up environment variables:
   ```
   cp .env.example .env
   ```
   Then edit `.env` with your local configuration values. Never commit this file.
4. Initialize the database:
   ```
   bun run db:push
   ```
5. Start the development server:
   ```
   bun run dev
   ```

The application should now be running at `http://localhost:3000`.

## Project Structure

Understanding the directory layout will help you navigate the codebase:

- `src/app/api/` — All API route handlers following Next.js App Router conventions.
- `src/components/trading/` — Trading panels, chart components, and market widgets.
- `src/lib/` — Shared utilities, helpers, i18n configuration, and service layer logic.
- `prisma/` — Database schema definition and migration files.
- `mini-services/` — Standalone services such as the MT5 bridge and WebSocket price feed.

## Code Style

This project enforces a consistent code style across all contributions:

- **TypeScript strict mode** is enabled. All code must pass strict type checking with no `any` types unless absolutely necessary and explicitly justified.
- **ESLint** is configured with the Next.js recommended preset. Run `bun run lint` before committing to catch violations.
- **shadcn/ui** components are the standard building block. Use existing shadcn/ui primitives instead of creating custom UI components from scratch.
- **Tailwind CSS 4** is used for all styling. Do not create custom CSS files. Use utility classes exclusively. If a style cannot be expressed with existing utilities, discuss it in the pull request before introducing a workaround.

## Commit Messages

This project follows the Conventional Commits specification. Every commit message must start with one of the following prefixes:

- `feat:` — A new feature or capability.
- `fix:` — A bug fix.
- `chore:` — Maintenance tasks, dependency updates, tooling changes.
- `docs:` — Documentation-only changes.

Use the imperative mood in the subject line. Keep the subject line under 72 characters. Provide a blank line followed by a body if additional context is needed.

Examples:

```
feat: add Ichimoku cloud indicator
fix: resolve balance desync on stop-out events
chore: update bun to 1.2.0
docs: clarify MT5 bridge setup steps
```

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. Implement your changes with clear, focused commits.
3. Open a pull request against the `main` branch of the upstream repository.
4. Ensure all CI checks pass: linting, production build, and test suite.
5. Provide a clear description of the changes, the motivation, and any relevant issue references.
6. Wait for a code review. Address feedback before requesting re-review.

Do not squash commits unless asked. Keep the history meaningful.

## Testing

This project uses **Vitest** as its testing framework.

- Run the full test suite with:
  ```
  bun run test
  ```
- Test files reside in the `tests/` directory at the project root.
- All new features must include corresponding tests. Bug fixes should include a regression test that reproduces the original issue.
- Aim for tests that cover the happy path, error cases, and edge conditions.

## API Routes

When adding or modifying API routes, follow these established patterns:

- Use `NextRequest` and `NextResponse` from `next/server` for all route handlers.
- Wrap handler logic in `try/catch` blocks and use `safeLog` from `src/lib/safe-log.ts` for error reporting. Never use raw `console.log` in production code paths.
- Apply rate limiting to all mutation endpoints (POST, PUT, DELETE).
- Call `validateAuth` for all POST, PUT, and DELETE routes to enforce authentication.
- Validate all input using **Zod** schemas before processing. Reject invalid payloads with a 400 status and a descriptive error message.
- Return consistent JSON response shapes across all endpoints.

## Database Changes

All database modifications go through Prisma:

1. Edit `prisma/schema.prisma` to add or modify models and fields.
2. Run `bun run db:push` locally to apply the changes to your SQLite database.
3. Do not manually create migration files. Migrations are regenerated automatically during deployment.
4. Test your schema changes thoroughly with the application before submitting.

## Adding New Features

When building new features, follow these steps:

1. Check existing panels in `src/components/trading/` to understand the established component patterns.
2. New interactive components must include the `'use client'` directive at the top of the file.
3. Compose UI using shadcn/ui components. Ensure layouts are responsive across mobile, tablet, and desktop viewports.
4. If the feature introduces user-facing text, add the corresponding keys to `src/lib/i18n.ts` under both the English and Indonesian (`id`) locales.
5. Follow the existing folder and naming conventions. Keep components focused and reasonably sized.

## Security Notes

Security is critical in a trading application. Adhere to these rules without exception:

- Never commit secrets, API keys, tokens, or credentials to the repository. Use `.env` files which are git-ignored.
- Never hardcode API keys, connection strings, or any sensitive value in source code.
- Use timing-safe comparison functions when validating secrets or tokens to prevent timing attacks.
- Use `safe-log.ts` for all logging. Never use `console.log`, `console.error`, or `console.warn` in application code, as these may leak sensitive information in production.

## License

This project is private. All rights reserved. No code, documentation, or other materials from this repository may be reproduced, distributed, or used outside of the authorized team without explicit written permission.
