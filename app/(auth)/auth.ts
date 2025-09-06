import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import {
  createGuestUser,
  findOrCreateOAuthUser,
  upgradeGuestToRegularUser,
} from '@/lib/db/queries';
import { authConfig } from './auth.config';
import type { DefaultJWT } from 'next-auth/jwt';
import GitHub from 'next-auth/providers/github';

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

if (!process.env.AUTH_SECRET) {
  throw new Error('Missing required AUTH_SECRET environment variable');
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
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
      try {
        if (authUser) {
          token.id = authUser.id as string;
          token.type = authUser.type;
          token.creditBalance = authUser.creditBalance;
        }

        // Handle GitHub OAuth user creation/authentication
        if (account?.provider === 'github' && token.email) {
          try {
            let authenticatedUser = null;

            // Check if we have an existing user ID (from guest session)
            if (token.id) {
              // This is a guest user upgrading to regular user
              console.log(
                `Attempting to upgrade guest user ${token.id} to regular user with email ${token.email}`,
              );
              try {
                authenticatedUser = await upgradeGuestToRegularUser(
                  token.id,
                  token.email,
                );
                if (authenticatedUser) {
                  console.log(
                    `Successfully upgraded guest user to regular user with ID ${authenticatedUser.id}`,
                  );
                }
              } catch (upgradeError) {
                console.warn(
                  `Failed to upgrade guest user ${token.id}, falling back to new user creation:`,
                  upgradeError,
                );
              }
            }

            // If upgrade failed or this is a new user, create/find OAuth user
            if (!authenticatedUser) {
              console.log(
                `Creating/finding OAuth user for email ${token.email}`,
              );
              authenticatedUser = await findOrCreateOAuthUser(token.email);
              if (authenticatedUser) {
                console.log(
                  `Successfully authenticated GitHub user ${token.email} with ID ${authenticatedUser.id}`,
                );
              }
            }

            // Update token with authenticated user data
            if (authenticatedUser) {
              token.id = authenticatedUser.id;
              token.type = 'regular';
              token.creditBalance = authenticatedUser.creditBalance;
            } else {
              console.error(
                'Failed to authenticate user - no user returned from database operations',
              );
              // Keep existing token data to prevent breaking the session
            }
          } catch (error) {
            console.error('Error handling GitHub OAuth user:', error);
            // Don't throw here - let authentication continue with existing token data
            // The error will be logged but won't break the auth flow
          }
        }

        return token;
      } catch (error) {
        console.error('JWT callback error:', error);
        // Return token even on error to prevent auth failures
        return token;
      }
    },
    async session({ session, token }) {
      try {
        if (session.user) {
          session.user.id = token.id;
          session.user.type = token.type;
          session.user.creditBalance = token.creditBalance;
        }

        return session;
      } catch (error) {
        console.error('Session callback error:', error);
        return session;
      }
    },
    async signIn({ user, account }) {
      try {
        // Ensure GitHub users get the 'regular' type
        if (account?.provider === 'github') {
          user.type = 'regular';
        }
        return true;
      } catch (error) {
        console.error('SignIn callback error:', error);
        return false; // Deny sign in on error
      }
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
