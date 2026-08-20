import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';

// POST - Register new user
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  // Check if registration is enabled
  const allowRegistration = process.env.ALLOW_REGISTRATION === 'true';
  if (!allowRegistration) {
    return NextResponse.json(
      { error: 'Registration is currently disabled' },
      { status: 403 }
    );
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const body = await request.json();
    const { email, password, name } = body as {
      email?: string;
      password?: string;
      name?: string;
    };

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate password minimum length
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const user = await db.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name: name || null,
        role: 'user',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    safeLog({
      level: 'info',
      route: 'Auth-Register',
      message: `New user registered: ${email}`,
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    logApiError('Auth-Register', error);
    return NextResponse.json(
      { error: 'Failed to register user' },
      { status: 500 }
    );
  }
}
