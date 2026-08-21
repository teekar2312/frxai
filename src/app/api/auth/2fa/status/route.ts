import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ enabled: false, verified: false });
    }
    const twoFactor = await db.userTwoFactor.findUnique({
      where: { userId: session.user.id },
    });
    return NextResponse.json({
      enabled: twoFactor?.enabled || false,
      verified: !!twoFactor?.verifiedAt,
    });
  } catch {
    return NextResponse.json({ enabled: false, verified: false });
  }
}
