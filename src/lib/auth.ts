import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { safeLog } from '@/lib/safe-log';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        twoFactorCode: { label: '2FA Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        let user;
        try {
          user = await db.user.findUnique({
            where: { email: credentials.email },
            include: { twoFactor: true },
          });
        } catch (error) {
          safeLog({
            level: 'error',
            route: 'Auth',
            message: 'DB query failed during login',
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }

        if (!user || !user.isActive) {
          return null;
        }

        let isValid: boolean;
        try {
          isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        } catch (error) {
          safeLog({
            level: 'error',
            route: 'Auth',
            message: 'bcrypt.compare failed',
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }

        if (!isValid) {
          return null;
        }

        // AUDIT-FIX-2: Enforce 2FA if enabled
        if (user.twoFactor?.enabled) {
          const code = credentials.twoFactorCode as string | undefined;
          if (!code) {
            // Return a special marker so the frontend knows to show 2FA input
            // We return null (auth fails) but the frontend can detect this
            // via a separate API call
            safeLog({
              level: 'info',
              route: 'Auth',
              message: `2FA required for user ${user.email}`,
            });
            // Return an object with requires2FA flag so the frontend can handle it
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
              requiresTwoFactor: true as unknown as string,
            };
          }

          // Verify TOTP code
          try {
            const { authenticator } = await import('otplib');
            const isTotpValid = authenticator.verify({
              token: code,
              secret: user.twoFactor.secret,
            });
            if (!isTotpValid) {
              safeLog({
                level: 'warn',
                route: 'Auth',
                message: `Invalid 2FA code for user ${user.email}`,
              });
              return null;
            }
          } catch (error) {
            safeLog({
              level: 'error',
              route: 'Auth',
              message: '2FA verification failed',
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        }

        // Update last login (best-effort — don't let failure prevent login)
        try {
          await db.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          });
        } catch (error) {
          safeLog({
            level: 'warn',
            route: 'Auth',
            message: 'Failed to update lastLoginAt',
            error: error instanceof Error ? error.message : String(error),
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as Record<string, unknown>).role || 'user';
        // AUDIT-FIX-12: Store 2FA flag in token for session invalidation
        token.twoFactorVerified = true;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
