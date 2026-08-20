import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateAuth, requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

// GET - List comments for a signal
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { id } = await params;

    const signal = await db.sharedSignal.findUnique({ where: { id } });
    if (!signal) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    const comments = await db.signalComment.findMany({
      where: { signalId: id },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ comments });
  } catch (error) {
    logApiError('SignalComments', error);
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

// POST - Add comment to a signal
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { content, author } = body as { content?: string; author?: string };

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'content is required and must be a string' }, { status: 400 });
    }

    if (content.length > 1000) {
      return NextResponse.json({ error: 'Comment must be 1000 characters or less' }, { status: 400 });
    }

    const signal = await db.sharedSignal.findUnique({ where: { id } });
    if (!signal) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    const comment = await db.signalComment.create({
      data: {
        signalId: id,
        author: author || null,
        content,
      },
    });

    // Increment comment count on signal
    await db.sharedSignal.update({
      where: { id },
      data: { commentCount: { increment: 1 } },
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    logApiError('SignalComments', error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
