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
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        let user;
        try {
          user = await db.user.findUnique({
            where: { email: credentials.email },
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
        token.role = (user as { role?: string }).role || 'user';
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
