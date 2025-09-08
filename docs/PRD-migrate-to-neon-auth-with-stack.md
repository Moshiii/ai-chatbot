## PRD: Migrate Authentication to Neon Auth (Stack Auth)

### Overview

We will replace the current Auth.js–based flow with Neon Auth powered by Stack Auth. This will standardize authentication, simplify OAuth flows, and unlock first-class Row Level Security (RLS) on Neon. We will keep our existing domain data (chats, messages, documents, etc.) and continue using the existing `user` table. We will add a `stackUserId` column to link app users to Stack identities while preserving app-specific fields (e.g., credit balance).

This PRD supersedes `docs/PRD-integrate-authjs-drizzle-adapter.md`.

### Goals

- **Adopt Neon Auth (Stack Auth)** for all sign-in/sign-out/session handling.
- **Remove Auth.js dependencies** (providers, adapters, callbacks, middleware) and associated tables.
- **Link existing `user` table to Stack IDs** by adding `stackUserId` (text, unique) while preserving `creditBalance` and other app fields.
- **Keep UX parity** for sign-in with GitHub; update the `/login` page to use Stack.
- **Follow Next.js 15 best practices**: default Server Components, minimal client state, App Router handlers, proper error boundaries and Suspense.

### Non-goals (this iteration)

- Merging historical guest sessions with newly created Stack users.
- Migrating legacy Auth.js session/account records; they will be deprecated and removed.
- Adding new OAuth providers beyond GitHub.

### Success Metrics

- Users can sign in/out via Stack; sessions persist and hydrate reliably across reloads.
- New app user rows are created on first login and linked to the Stack user ID.
- All app flows that rely on `session.user.id` continue to function with the Stack identity.
- RLS policies enforce per-user access in Neon (where applicable).

### Affected Areas

- Next.js auth code: `app/(auth)/**`, `middleware.ts`
- DB schema and migrations: replace/remove Auth.js tables, add `stackUserId` to `user`, add RLS ownership columns on domain tables
- Login UI: `app/(auth)/login/page.tsx`
- Server utilities that read the current user/session

### Environment Variables

Add the following from the Neon Console (Auth section) / Stack project:

```env
NEXT_PUBLIC_STACK_PROJECT_ID=...
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=...
STACK_SECRET_SERVER_KEY=...

# Neon database
DATABASE_URL=...                         # Owner/super connection for server code
DATABASE_AUTHENTICATED_URL=...           # (Optional) Authenticated role connection for RLS-bound operations
```

### Dependencies

- `@stackframe/stack` (Stack Auth SDK)
- (Recommended) `@stackframe/next` for Next.js App Router helpers and handlers
- Drizzle ORM (already in use)

### High-level Design

1. **Replace Auth.js with Stack Auth**
   - Initialize Stack in a shared module (server-only initialization).
   - Expose Stack’s Next.js App Router handlers under `app/api/stack/[...stack]/route.ts` (exact route per docs) to support sign-in/out, callbacks, and webhooks.
   - Provide server-side helpers to fetch the current user/claims (e.g., via Stack’s server APIs).

2. **Use existing `user` table + Stack linkage (RLS-ready)**
   - Add `stackUserId` (text, unique, nullable initially) to `user` to store the Stack user ID.
   - Keep existing UUID `user.id` as the application primary key; do not change current FKs.
   - Introduce RLS ownership columns on domain tables (see below) that hold the Stack user ID for policy checks.

3. **Login UI**
   - Update `/login` to use Stack sign-in (GitHub OAuth). Keep the page server-rendered where possible; use client interactivity only for the button action.

4. **Middleware / route protection**
   - Replace any NextAuth middleware with a Stack-based guard, or do server-side validation in route handlers and Server Components.

### Data Model & RLS

We will continue using the current `user` table and augment it to store the Stack ID. Domain tables will gain a dedicated ownership column that contains the Stack user ID string for RLS policies while we keep existing UUID-based relations for joins and integrity.

- `user` table change (conceptual):

```ts
// Add to existing user table
// stackUserId: text UNIQUE NULL
// (populate on first Stack login; may remain NULL for historical/guest users)
```

- Recommended RLS approach for tables with per-user ownership (conceptual Drizzle snippet):

```ts
// example per Neon + Drizzle RLS patterns
// import { authenticatedRole, authUid, crudPolicy } from 'drizzle-orm/neon';
// pgTable('my_table', { userId: text('user_id').notNull().default(sql`(auth.user_id())`), ... }, (table) => [
//   crudPolicy({ role: authenticatedRole, read: authUid(table.userId), modify: authUid(table.userId) }),
// ]);
```

### Migration Plan

We will execute the migration in phases to reduce risk.

- Phase 0: Prep
  - Ship PRD and secure credentials from Neon/Stack.
  - Add SDK dependencies.

- Phase 1: Introduce Stack alongside Auth.js (feature-flagged)
  - Add Stack initialization and route handlers under `/api/stack`.
  - Implement a new `/login` path that uses Stack sign-in for GitHub.
  - Add a server utility to read the current Stack user; thread it through places that currently rely on Auth.js where feasible.

- Phase 2: Schema updates for `user` and domain ownership
  - Add `stackUserId text UNIQUE NULL` to `user`.
  - For each domain table that needs per-user isolation (e.g., `chat`, `document`, `vote`, `suggestion`), add `owner_id text` with default `auth.user_id()` for new writes.
  - Start writing `owner_id` from the current Stack user ID in server actions. Keep existing UUID `userId`/FKs for joins and integrity (temporary dual-write if needed).
  - Apply RLS policies on `owner_id` using `auth.user_id()`.

- Phase 3: Cut-over and clean-up
  - Switch access-control checks to `owner_id` (RLS) and retain UUID joins as-is.
  - Backfill historical rows if a reliable mapping exists; otherwise, gate old rows behind admin-only views.
  - Remove Auth.js code: `app/(auth)/auth.ts`, `auth.config.ts`, `[...nextauth]/route.ts`, Credentials provider, and the Drizzle adapter wiring.
  - Drop legacy tables used by Auth.js: `account`, `session`, `verification_token`. Keep `user`.

### Implementation Steps (Detailed)

1. Setup Neon Auth
   - In the Neon Console → Auth → Set up Auth (provisions a Stack project).
   - Capture `NEXT_PUBLIC_STACK_PROJECT_ID`, `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`, `STACK_SECRET_SERVER_KEY`.
   - Ensure `DATABASE_URL` is configured; optionally set up `DATABASE_AUTHENTICATED_URL` for RLS-bound connections.

2. Install and initialize Stack
   - `pnpm add @stackframe/stack` (and `@stackframe/next` if using Next helpers from docs).
   - Create a server-only initializer (e.g., `lib/stack.ts`) to configure the SDK with the env vars.
   - Add App Router handlers (e.g., `app/api/stack/[...stack]/route.ts`) using the SDK’s documented handler factory.

3. Replace login page
   - Update `app/(auth)/login/page.tsx` to trigger Stack’s GitHub sign-in flow.
   - Keep UI minimal; ensure proper redirects (default `/`).

4. Server session/user access
   - Replace uses of NextAuth’s `auth()`/`getServerSession()` with Stack’s server helpers (per docs) to read the user and claims in RSC/route handlers.

5. Add `app_user` and RLS
   - Drizzle migration to create `app_user (id text primary key, credit_balance numeric default '0.00')`.
   - Add `owner_id text` columns to domain tables that need per-user isolation (e.g., `chat`, `document`, `vote`, `suggestion`) and start writing them from server actions.
   - Configure Neon RLS (install `pg_session_jwt`, set `crudPolicy` or equivalent SQL RLS rules).

6. Remove Auth.js
   - Delete the NextAuth adapter and providers, route file `app/(auth)/api/auth/[...nextauth]/route.ts`, and `app/(auth)/auth.ts`.
   - Remove Auth.js client calls from components and replace with Stack equivalents.
   - Drop Auth.js tables once code no longer references them.

### Testing Plan

- Unit/logic
  - Verify server utilities correctly resolve the current Stack user and claims.
  - Validate new write paths set `owner_id`.

- Manual QA
  - New user signs in with GitHub → a `user` row is created or updated; `stackUserId` is set; default `creditBalance` remains `"0.00"`.
  - Return user signs in → same `user` row is reused; session persists.
  - Core flows (create chat, list chats, send message) work and are scoped to the authenticated user.

- Lint & Types
  - `pnpm run lint` passes (Next.js 15 guidance).

### Rollout Plan

- Ship behind a feature flag to allow internal testing.
- Validate on staging with RLS policies enabled.
- Migrate production logins; monitor error rates and DB traffic.

### Risks & Mitigations

- **Historic data ownership mapping**: Old rows keyed by legacy `user.id` (UUID) won’t match Stack IDs.
  - Mitigation: dual-write new `owner_id` columns; backfill where possible; gate legacy views.
- **SDK API drift**: Stack’s Next.js APIs may change.
  - Mitigation: follow docs closely; pin versions; add e2e sign-in tests.
- **RLS misconfiguration**: Incorrect policies could block valid access.
  - Mitigation: start with read-only policies, add tests, gradually tighten.

### Backout Plan

- Revert to the Auth.js branch; keep previous login page and middleware.
- Disable the Stack handlers and remove feature flag.

### References

- Neon Auth and RLS with Stack (Neon docs)
- Stack Auth SDK for Next.js (Stack docs)
