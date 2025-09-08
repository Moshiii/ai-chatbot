import 'server-only';
import { stackServerApp } from './stack';
import { findOrCreateOAuthUser } from '@/lib/db/queries';
import type { User } from '@/lib/db/schema';

export async function getCurrentStackUser() {
  try {
    const user = await stackServerApp.getUser();
    return user;
  } catch (error) {
    console.error('Failed to get current Stack user:', error);
    return null;
  }
}

export async function getCurrentAppUser(): Promise<User | null> {
  try {
    const stackUser = await getCurrentStackUser();
    if (!stackUser || !stackUser.primaryEmail) {
      return null;
    }

    // Find or create app user linked to Stack user
    const appUser = await findOrCreateOAuthUser(
      stackUser.primaryEmail,
      stackUser.id,
    );
    return appUser;
  } catch (error) {
    console.error('Failed to get current app user:', error);
    return null;
  }
}

export async function requireCurrentAppUser(): Promise<User> {
  const user = await getCurrentAppUser();
  if (!user) {
    throw new Error('Authentication required');
  }
  return user;
}
