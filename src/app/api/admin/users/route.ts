import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeLog } from '@/lib/safe-log';

async function requireAdmin(_request: NextRequest): Promise<{
  authorized: boolean;
  userId?: string;
  error?: NextResponse;
}> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { authorized: false, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }
    const user = await db.user.findUnique({ where: { email: session.user.email } });
    if (!user || user.role !== 'admin') {
      return { authorized: false, error: NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 }) };
    }
    return { authorized: true, userId: user.id };
  } catch (error) {
    safeLog({ level: 'error', route: 'admin/users', message: 'Auth check failed', error: error instanceof Error ? error.message : String(error) });
    return { authorized: false, error: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
  }
}

// GET /api/admin/users — list all users (exclude password hash)
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const users = await db.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ users });
  } catch (error) {
    safeLog({ level: 'error', route: 'admin/users', message: 'Failed to list users', error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
  }
}

// PUT /api/admin/users — update user role or isActive
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { userId, role, isActive } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const data: Record<string, string | boolean> = {};
    if (role !== undefined) {
      if (role !== 'admin' && role !== 'user') {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      data.role = role;
    }
    if (isActive !== undefined) {
      data.isActive = Boolean(isActive);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Prevent admin from deactivating themselves
    if (userId === auth.userId && data.isActive === false) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });

    safeLog({ level: 'info', route: 'admin/users', message: `User updated: ${updated.email}`, category: 'system' });
    return NextResponse.json({ user: updated });
  } catch (error) {
    safeLog({ level: 'error', route: 'admin/users', message: 'Failed to update user', error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE /api/admin/users — soft-delete user (set isActive=false)
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });
    }

    if (userId === auth.userId) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: { isActive: false },
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });

    safeLog({ level: 'info', route: 'admin/users', message: `User soft-deleted: ${updated.email}`, category: 'system' });
    return NextResponse.json({ user: updated });
  } catch (error) {
    safeLog({ level: 'error', route: 'admin/users', message: 'Failed to delete user', error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
