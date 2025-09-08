import 'server-only';
import { stackServerApp } from './stack';
import { findOrCreateOAuthUser } from '@/lib/db/queries';
import type { User } from '@/lib/db/schema';

export async function getCurrentStackUser(request?: Request) {
  const user = await stackServerApp.getUser(
    request ? { tokenStore: request } : undefined,
  );
  return user;
}

export async function getCurrentAppUser(
  request?: Request,
): Promise<User | null> {
  const stackUser = await getCurrentStackUser(request);
  if (!stackUser || !stackUser.primaryEmail) {
    return null;
  }

  // Find or create app user linked to Stack user
  const appUser = await findOrCreateOAuthUser(
    stackUser.primaryEmail,
    stackUser.id,
  );
  return appUser;
}

export async function requireCurrentAppUser(request?: Request): Promise<User> {
  const user = await getCurrentAppUser(request);
  if (!user) {
    throw new Error('Authentication required');
  }
  return user;
}
