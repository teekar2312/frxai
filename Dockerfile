# syntax=docker/dockerfile:1
# ============================================================
# FINEX AI TRADING SYSTEM — Dockerfile (multi-stage)
#
# Tahap 1 "build"  : image Bun (Debian) — install dependency,
#                    generate Prisma client, build Next.js.
#                    Output standalone sudah diaktifkan di next.config.ts
#                    (output: "standalone") + script build menyalin
#                    .next/static & public/ ke .next/standalone/.
# Tahap 2 "runner" : image Node 22 Alpine yang ringan — hanya berisi
#                    server standalone, static assets, public/,
#                    python-engine/ (untuk route download ZIP engine),
#                    plus openssl (Prisma) & sqlite (backup manual).
# ============================================================

# -------------------- Tahap 1: build --------------------
FROM oven/bun:1 AS build
WORKDIR /app

# Salin manifest dependency lebih dulu agar cache layer efektif
# (bun.lock opsional — bila ada, bun install otomatis memakainya;
#  untuk CI strict boleh diganti: bun install --frozen-lockfile)
COPY package.json bun.lock* ./

# Install seluruh dependency
RUN bun install

# Salin sisa source code proyek
COPY . .

# Default DATABASE_URL saat build (hanya untuk amannya next build;
# nilai runtime diambil dari .env / env docker-compose)
ENV DATABASE_URL=file:/app/db/custom.db

# Tambahkan target binary musl (untuk runner Alpine) pada SALINAN schema
# di dalam image — file prisma/schema.prisma di repo TIDAK diubah.
# Tanpa ini, query engine Prisma (dibangun di Debian) gagal dimuat di Alpine.
# Dilewati bila schema sudah punya binaryTargets sendiri.
RUN grep -q 'binaryTargets' prisma/schema.prisma \
      || sed -i 's|provider = "prisma-client-js"|provider = "prisma-client-js"\n  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]|' prisma/schema.prisma

# Generate Prisma Client (engine native + musl)
RUN bunx prisma generate

# Build Next.js → .next/standalone/server.js + salin static & public.
# Di-inline (bukan `bun run build`) karena image bun tidak memuat node —
# sedangkan package.json build kini wrapper Node lintas platform
# (untuk dev di Windows/macOS/Linux). Container selalu Linux → cp aman.
RUN ./node_modules/.bin/next build \
      && cp -r .next/static .next/standalone/.next/ \
      && cp -r public .next/standalone/

# -------------------- Tahap 2: runner --------------------
FROM node:22-alpine AS runner
# openssl  : runtime query engine Prisma di musl
# sqlite   : utilitas sqlite3 untuk backup manual di dalam container
RUN apk add --no-cache openssl sqlite
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Default path DB di dalam container (volume ./db:/app/db).
# Bila .env (env_file) mendefinisikan DATABASE_URL, nilai itu yang dipakai —
# pastikan di Docker DATABASE_URL=file:/app/db/custom.db
ENV DATABASE_URL=file:/app/db/custom.db

# Server standalone Next.js (server.js + node_modules ter-trace)
COPY --from=build /app/.next/standalone ./
# Static assets hasil build
COPY --from=build /app/.next/static ./.next/static
# File publik (logo.svg, robots.txt, dst.)
COPY --from=build /app/public ./public
# Python engine — dibutuhkan saat runtime oleh route /api/engine/download
# yang membungkus folder ini menjadi ZIP untuk di-download user
COPY --from=build /app/python-engine ./python-engine

# Folder database SQLite (di-mount sebagai volume via docker-compose)
RUN mkdir -p /app/db

EXPOSE 3000

# Jalankan server standalone Next.js
CMD ["node", "server.js"]
