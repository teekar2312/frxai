import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { AI_PROVIDERS, isProviderAvailable } from '@/lib/ai-provider';
import { logApiError } from '@/lib/safe-log';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();
  const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};

  // Database check
  try {
    const dbStart = Date.now();
    await db.tradingConfig.findFirst();
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (error) {
    logApiError('Health', error);
    checks.database = {
      status: 'error',
      detail: 'Database connection failed',
    };
  }

  // AI providers availability
  const availableProviders: string[] = [];
  const unavailableProviders: string[] = [];
  for (const [id, config] of Object.entries(AI_PROVIDERS)) {
    if (isProviderAvailable(id as keyof typeof AI_PROVIDERS)) {
      availableProviders.push(config.name);
    } else {
      unavailableProviders.push(config.name);
    }
  }
  checks.ai_providers = {
    status: availableProviders.length > 0 ? 'ok' : 'degraded',
    detail: `Available: [${availableProviders.join(', ')}] | Unavailable: [${unavailableProviders.join(', ')}]`,
  };

  const totalLatency = Date.now() - startTime;
  const hasErrors = Object.values(checks).some(c => c.status === 'error');
  const hasDegraded = Object.values(checks).some(c => c.status === 'degraded');

  return NextResponse.json(
    {
      status: hasErrors ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor(process.uptime()),
      latencyMs: totalLatency,
      checks,
    },
    { status: hasErrors ? 503 : 200 }
  );
}
