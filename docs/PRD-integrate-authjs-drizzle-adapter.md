## PRD: Integrate Auth.js Drizzle Adapter (Option A)

### Overview

We will integrate the Auth.js Drizzle adapter into our existing Next.js auth flow to persist users, accounts, sessions, and verification tokens in our Neon Postgres database. We will continue using GitHub as the OAuth provider and retain the current guest sign-in via Credentials. Primary outcome: successful GitHub sign-ins automatically create entries in our database, enabling reliable user IDs and emails for chat ownership and related features.

### Goals

- **Persist users/accounts/sessions** via Auth.js Drizzle adapter in Neon Postgres.
- **Create user entries on first GitHub login** automatically, with `creditBalance` defaulting to `"0.00"` per our schema.
- **Keep GitHub as the only OAuth provider** for now.
- **Minimize code changes** to preserve the current app behavior.

### Non-goals (for this iteration)

- **Neon Auth dashboard integration** or population of `neon_auth.*` tables.
- **Guest-to-GitHub account merge** (keeping the same user ID when upgrading from guest to GitHub). This can be tackled later as a separate enhancement.
- **Adding or changing database schema** beyond what already exists.

### Success Metrics

- After GitHub login, the following are present in DB: a new row in `user` and a linked row in `account`.
- Session-based routes function with persisted sessions.
- No manual user creation in callbacks is required for OAuth sign-ins.

### Affected Areas

- Auth server configuration (`app/(auth)/auth.ts`).
- Callback logic for JWT/session in Auth.js.
- Application code that relies on `session.user.id`, `session.user.type`, and `session.user.creditBalance` (unchanged behavior expected).

### Environment Variables

- Already set: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET`, `POSTGRES_URL`.
- Not required for this option: `NEXT_PUBLIC_STACK_PROJECT_ID` and other Neon Auth SDK keys.

### Data Model

We already have Drizzle tables compatible with Auth.js adapter usage:

- `user` (uuid PK, `email` required, `password` optional, `creditBalance` default `"0.00"`).
- `account` (composite PK on `(provider, providerAccountId)`; foreign key to `user`).
- `session` (references `user`).
- `verification_token`.

Note: Our `user` table doesn’t include optional Auth.js fields (`name`, `image`, `emailVerified`), which is acceptable for our current requirements. Defaults and app-level fields (e.g., `creditBalance`) are handled by our schema.

### High-level Design

- **Add Drizzle adapter** to the Auth.js config to persist login state.
- **Remove custom OAuth user creation in JWT callback**. Trust adapter to create users and link accounts. Keep the logic that sets `token.type = 'regular'` for GitHub.
- **Keep guest credential sign-in** as-is. Guest-to-GitHub merge is deferred (documented below in Future Work).

### File-level Edits

- `app/(auth)/auth.ts`
  - **Add imports**:
    - `DrizzleAdapter` from `@auth/drizzle-adapter`.
    - `db` from `@/lib/db/queries`.
    - `user`, `account`, `session`, `verification_token` from `@/lib/db/schema`.
  - **Add `adapter` to NextAuth config**:
    - `adapter: DrizzleAdapter(db as any, { users: user, accounts: account, sessions: session, verificationTokens: verification_token } as any) as any`.
    - Rationale: minimal type churn; matches our current schema shapes.
  - **Remove manual OAuth user creation** in `callbacks.jwt`:
    - Remove uses of `findOrCreateOAuthUser` and `upgradeGuestToRegularUser` inside the `github` branch.
    - Keep setting `token.id`, `token.type`, and `token.creditBalance` when `authUser` is present.
    - Keep forcing `token.type = 'regular'` when `account.provider === 'github'`.
  - **Clean up unused imports**:
    - Remove `findOrCreateOAuthUser` and `upgradeGuestToRegularUser` imports if no longer referenced.
  - **No change** to `Credentials` provider (guest sign-in) and `session` callback shape.

- `app/(auth)/api/auth/[...nextauth]/route.ts`
  - No change. Continues to export `{ GET, POST }` from `auth.ts`.

- `lib/db/queries.ts`, `lib/db/schema.ts`
  - No functional change required. Our tables already match the adapter usage.
  - Ensure DB URL is set via `POSTGRES_URL` (already used).

### Example of target callback simplification (for clarity)

This is a reference outline of the intended shape after the edit (names preserved, exact code will be updated in-branch):

```typescript
callbacks: {
  async jwt({ token, user: authUser, account }) {
    try {
      if (authUser) {
        token.id = (authUser as any).id as string;
        token.type = (authUser as any).type ?? token.type;
        token.creditBalance = (authUser as any).creditBalance ?? token.creditBalance ?? '0.00';
      }

      if (account?.provider === 'github') {
        token.type = 'regular';
      }

      return token;
    } catch (error) {
      console.error('JWT callback error:', error);
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
}
```

### Rollout Plan

- Implement edits on a feature branch.
- Verify local sign-in via GitHub using the `/login` page.
- Validate DB state post-login:
  - `SELECT id, email, credit_balance FROM "user" ORDER BY created_at DESC NULLS LAST;` (adjust columns as needed)
  - `SELECT provider, provider_account_id, user_id FROM account ORDER BY id DESC;`
  - `SELECT session_token, user_id, expires FROM session ORDER BY id DESC;`
- Sanity check app flows (creating chats, viewing profile) with the persisted `session.user.id`.

### Testing Plan

- Unit/logic:
  - Exercise the callbacks to ensure `session.user` is populated as before.
- Manual QA:
  - New user signs in with GitHub → `user` and `account` rows created; `session` row created.
  - Return user signs in again → no extra `user` row; one `account` row remains linked.
  - Guest sign-in flow remains functional.
- Lint:
  - `pnpm run lint` should pass.

### Risks & Mitigations

- **Duplicate users when upgrading guest → GitHub**: Acceptable for this iteration; document as future work. Mitigation later: explicit merge/migration step or linking flow.
- **Type conflicts with adapter**: We use `as any` to minimize disruption; can improve typings in a follow-up.
- **Schema mismatch**: Our `user` table lacks optional `name`, `image`, `emailVerified` fields. Adapter operations used by GitHub OAuth don’t require them for our use case.

### Future Work (out of scope here)

- Seamless guest-to-GitHub upgrade: preserve the same `user.id` and migrate ownership (chats, messages, etc.). Options include a dedicated merge endpoint or a one-time background migration.
- Add support for additional providers.
- Tighten adapter typings and remove `as any` casts.

### Backout Plan

- Revert the branch. The previous behavior (non-persisted Auth.js without adapter-based user creation) will continue to function as before.
