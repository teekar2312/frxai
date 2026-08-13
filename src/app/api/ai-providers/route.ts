import { NextResponse } from 'next/server';
import { AI_PROVIDERS, isProviderAvailable, getAvailableProviders } from '@/lib/ai-provider';

// GET - List all AI providers and their availability
export async function GET() {
  try {
    const allProviders = Object.values(AI_PROVIDERS).map(p => ({
      id: p.id,
      name: p.name,
      models: p.models,
      isAvailable: isProviderAvailable(p.id),
    }));

    return NextResponse.json({
      providers: allProviders,
      availableProviders: getAvailableProviders(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch AI providers' },
      { status: 500 }
    );
  }
}
