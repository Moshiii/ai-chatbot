import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { createGuestUser, db } from '@/lib/db/queries';
import { authConfig } from './auth.config';
import type { DefaultJWT } from 'next-auth/jwt';
import GitHub from 'next-auth/providers/github';
import { user } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export type UserType = 'guest' | 'regular';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
      creditBalance?: string;
    } & DefaultSession['user'];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
    creditBalance?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
    creditBalance?: string;
  }
}

// Validate required environment variables
if (!process.env.AUTH_GITHUB_ID || !process.env.AUTH_GITHUB_SECRET) {
  throw new Error(
    'Missing required GitHub OAuth environment variables: AUTH_GITHUB_ID and AUTH_GITHUB_SECRET',
  );
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
    Credentials({
      id: 'guest',
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser();
        return { ...guestUser, type: 'guest' };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user: authUser, account }) {
      if (authUser) {
        token.id = authUser.id as string;
        token.type = authUser.type;
        token.creditBalance = authUser.creditBalance;
      }

      // Handle GitHub OAuth user creation
      if (account?.provider === 'github' && !token.id && token.email) {
        try {
          // Check if user already exists
          const existingUsers = await db
            .select()
            .from(user)
            .where(eq(user.email, token.email));

          if (existingUsers.length > 0) {
            // User exists, use their data
            const existingUser = existingUsers[0];
            token.id = existingUser.id;
            token.type = 'regular';
            token.creditBalance = existingUser.creditBalance;
          } else {
            // Create new user for GitHub OAuth
            const [newUser] = await db
              .insert(user)
              .values({
                email: token.email,
                creditBalance: '0.00',
              })
              .returning({
                id: user.id,
                email: user.email,
                creditBalance: user.creditBalance,
              });

            token.id = newUser.id;
            token.type = 'regular';
            token.creditBalance = newUser.creditBalance;
          }
        } catch (error) {
          console.error('Error creating/finding GitHub user:', error);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
        session.user.creditBalance = token.creditBalance;
      }

      return session;
    },
    async signIn({ user, account }) {
      // Ensure GitHub users get the 'regular' type
      if (account?.provider === 'github') {
        user.type = 'regular';
      }
      return true;
    },
    async redirect({ url, baseUrl }) {
      // After successful login, redirect to the main chat page
      if (url.startsWith(baseUrl)) {
        return `${baseUrl}/`;
      }
      // Allows relative callback URLs
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      // Allows callback URLs on the same origin
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
});
