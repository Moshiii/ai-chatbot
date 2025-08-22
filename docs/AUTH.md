# Authentication Flow Documentation

This document explains the authentication flow implemented in this application, focusing on the use of `User` and `Account` tables with NextAuth.js (Auth.js), Neon Auth integration, and the custom logic for handling GitHub OAuth sign-ups.

## 1. User and Account Tables: Best Practices

In a robust authentication system, especially when supporting multiple authentication providers, it's a best practice to separate user profile information from authentication provider details. This is achieved through distinct `User` and `Account` tables:

- **`User` Table (`User` in `lib/db/schema.ts`)**:
  - **Purpose**: Stores the core profile information for a user within your application. This data is independent of how the user logs in.
  - **Content**: Includes fields like `id`, `email`, `password` (for credential providers), `creditBalance`, and any other application-specific user data.
  - **Relationship**: Each unique user in your application has one entry in this table.

- **`Account` Table (`accounts` in `lib/db/schema.ts`)**:
  - **Purpose**: Stores the details of a user's linked accounts from external authentication providers (e.g., GitHub, Google) or internal credential-based accounts.
  - **Content**: Includes provider-specific information such as `provider`, `providerAccountId`, `access_token`, `refresh_token`, and the `userId` which links back to an entry in the `User` table.
  - **Relationship**: A single user in the `User` table can have multiple associated entries in the `accounts` table if they link various authentication methods.

### Why this separation?

This separation provides:

1.  **Flexibility**: Supports multiple sign-in methods for a single user (e.g., GitHub and email/password).
2.  **Portability**: If an external account is deactivated, the user can still access their application profile through another linked method.
3.  **Security**: Compartmentalizes sensitive provider-specific tokens.
4.  **Adherence to Auth.js Design**: NextAuth.js is built to work seamlessly with this two-table model.

## 2. Database Schema for Authentication

The following tables are used to manage users and authentication data:

### `User` Table (`lib/db/schema.ts`)

```typescript
// lib/db/schema.ts
export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }),
  creditBalance: varchar("creditBalance", { length: 20 })
    .notNull()
    .default("0.00"),
});
```

### NextAuth.js Adapter Tables (`lib/db/schema.ts`)

These tables are based on the standard NextAuth.js adapter schema and were added via a migration (`lib/db/migrations/0009_nextauth_tables.sql`). They are managed internally by NextAuth.js and our custom JWT callback logic.

```typescript
// lib/db/schema.ts (Excerpt)
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 255 }).notNull(),
    providerAccountId: varchar("providerAccountId", { length: 255 }).notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: bigint("expires_at", { mode: "number" }),
    id_token: text("id_token"),
    scope: text("scope"),
    session_state: text("session_state"),
    token_type: text("token"),
  },
  (table) => ({
    providerProviderAccountIdIdx: primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
  })
);

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
  sessionToken: varchar("sessionToken", { length: 255 }).notNull().unique(),
});

export const verificationToken = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => ({
    identifierTokenIdx: primaryKey({
      columns: [table.identifier, table.token],
    }),
  })
);
```

## 3. Custom JWT Callback for GitHub OAuth User Creation

To ensure that users signing in with GitHub OAuth have a corresponding entry in our application's `User` table, a custom logic is implemented within the `jwt` callback in `app/(auth)/auth.ts`.

This logic checks if a user with the authenticated email already exists in our `User` table. If not, a new user entry is created. This bridges the gap between NextAuth.js's session management and our application's data requirements.

```typescript
// app/(auth)/auth.ts (Excerpt from callbacks)
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
        // Check if user already exists in our 'User' table
        const existingUsers = await db.select().from(user).where(eq(user.email, token.email));

        if (existingUsers.length > 0) {
          // User exists, use their data
          const existingUser = existingUsers[0];
          token.id = existingUser.id;
          token.type = 'regular'; // Existing GitHub user is 'regular'
          token.creditBalance = existingUser.creditBalance;
        } else {
          // Create new user for GitHub OAuth in our 'User' table
          const [newUser] = await db.insert(user).values({
            email: token.email,
            creditBalance: '0.00', // Default credit balance for new users
          }).returning({
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
    // Ensure GitHub users get the 'regular' type even if created implicitly
    if (account?.provider === 'github') {
      user.type = 'regular';
    }
    return true;
  },
  // ... other callbacks
},
```

## 4. Overall Authentication Flow

1.  **User Initiates Sign-in**: The user clicks the "Continue with GitHub" button (e.g., in `app/(auth)/login/page.tsx`).
2.  **NextAuth.js Redirects**: NextAuth.js handles the OAuth flow with GitHub.
3.  **JWT Callback**: After successful authentication with GitHub, the `jwt` callback is triggered:
    - It receives the `token`, the `user` object from the provider (`authUser`), and the `account` details.
    - It checks if a user exists in our `User` table with the email provided by GitHub.
    - If no user exists, a new user record is created in the `User` table.
    - The `token` is updated with the `id`, `type` (`regular`), and `creditBalance` from our `User` table.
4.  **Session Callback**: The `session` callback then uses the updated `token` to populate the `session.user` object, making the application's user ID and type available throughout the session.
5.  **Application Access**: With a valid session and a corresponding user ID in our `User` table, the user can now perform actions like creating chats, which require a `userId` foreign key.

## 5. Neon Auth + NextAuth.js Integration

### Current Implementation Pattern

The current implementation uses a **NextAuth.js + Neon Database + Database Triggers** approach:

**Complete Flow:**

1. **User Authentication**: User authenticates via GitHub OAuth through NextAuth.js
2. **Account Creation**: NextAuth.js automatically creates an entry in the `accounts` table
3. **Database Trigger**: Our `handle_new_user()` trigger function is fired on account creation
4. **User Record Creation**: Trigger ensures a corresponding `User` record exists with proper credit balance
5. **JWT Callback**: NextAuth.js JWT callback populates user email and profile data
6. **Session Management**: User session is established with complete profile information

**Database Trigger Function:**

```sql
-- lib/db/functions/00_handle_new_user.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
AS $$
BEGIN
  -- Ensure the User record exists with proper credit balance
  -- The actual user creation with email is handled by NextAuth.js JWT callbacks
  INSERT INTO public."User" (
    id,
    email,
    "creditBalance"
  ) VALUES (
    new."userId",
    '', -- Email will be populated by NextAuth.js
    0.00::decimal
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Ensure credit balance is always set for OAuth users
    "creditBalance" = COALESCE(NULLIF(public."User"."creditBalance", ''), 0.00::decimal);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on OAuth account creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON accounts
  FOR EACH ROW
  WHEN (new.type = 'oauth') -- Only trigger for OAuth accounts
  EXECUTE FUNCTION public.handle_new_user();
```

**Pros of Current Approach:**

- ✅ **Elegant Separation**: Database triggers handle data consistency, NextAuth.js handles auth flow
- ✅ **Credit System Ready**: Automatic credit balance initialization for all OAuth users
- ✅ **Type Safety**: Full TypeScript support with custom user types
- ✅ **Neon Optimized**: Works optimally with Neon's PostgreSQL features
- ✅ **Single Source of Truth**: `User` table becomes the application's user data authority

### Alternative: Pure Neon Auth

**Pure Neon Auth Approach:**

```typescript
// Simplified auth.ts without custom user creation
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
  ],
  // Remove custom JWT callback logic
  // Let Neon Auth handle user management automatically
});
```

**Pros:**

- ✅ **Simplicity**: No custom synchronization logic needed
- ✅ **Built-in Management**: Neon handles user lifecycle automatically
- ✅ **Reduced Complexity**: Less code to maintain
- ✅ **Better Performance**: No database roundtrips in auth flow

**Cons:**

- ❌ **Less Control**: Limited control over user profile structure
- ❌ **Vendor Lock-in**: Tightly coupled to Neon's user schema
- ❌ **Migration Difficulty**: Harder to migrate away from Neon Auth
- ❌ **Feature Limitations**: Limited customization options

### Recommendation for Current Setup

**Recommendation: Continue with Current Hybrid Approach**

**Rationale:**

1. **Application Requirements**: Need custom user fields (creditBalance, etc.)
2. **Data Model**: Existing database schema designed around custom `User` table
3. **Business Logic**: Application logic depends on custom user fields
4. **Migration Cost**: Significant refactoring needed to change approach

### Best Practices for Current Implementation

#### 1. User Creation Logic Optimization

**Current Implementation Issues:**

```typescript
// Current approach has potential race conditions
if (account?.provider === "github" && !token.id && token.email) {
  // Potential race condition: multiple requests creating the same user
  const existingUsers = await db
    .select()
    .from(user)
    .where(eq(user.email, token.email));
  if (existingUsers.length > 0) {
    // Handle existing user
  } else {
    // Create new user - RACE CONDITION HERE
  }
}
```

**Recommended Improvement:**

```typescript
// Use database constraints and proper error handling
if (account?.provider === "github" && !token.id && token.email) {
  try {
    // Attempt to create user, handle constraint violations
    const [newUser] = await db
      .insert(user)
      .values({
        email: token.email,
        creditBalance: "0.00",
      })
      .onConflictDoNothing() // Use database constraint
      .returning();

    if (newUser) {
      token.id = newUser.id;
      token.type = "regular";
      token.creditBalance = newUser.creditBalance;
    } else {
      // User already exists, fetch it
      const existingUsers = await db
        .select()
        .from(user)
        .where(eq(user.email, token.email));

      if (existingUsers.length > 0) {
        const existingUser = existingUsers[0];
        token.id = existingUser.id;
        token.type = "regular";
        token.creditBalance = existingUser.creditBalance;
      }
    }
  } catch (error) {
    console.error("Error in GitHub user creation:", error);
    // Continue without user creation - auth will still work
  }
}
```

#### 2. Database Schema Optimization

**Add Database Constraints:**

```sql
-- Add unique constraint on email
ALTER TABLE "User" ADD CONSTRAINT unique_user_email UNIQUE (email);

-- Add indexes for performance
CREATE INDEX idx_user_email ON "User"(email);
CREATE INDEX idx_accounts_user_id ON accounts("userId");
```

#### 3. Error Handling Improvements

**Enhanced Error Handling:**

```typescript
callbacks: {
  async jwt({ token, user: authUser, account }) {
    try {
      // User creation logic with proper error handling
      if (account?.provider === 'github' && !token.id && token.email) {
        await handleGitHubUserCreation(token, account);
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
},
```

#### 4. Security Best Practices

**Environment Variables:**

```env
# Required for GitHub OAuth
AUTH_GITHUB_ID=your_github_client_id
AUTH_GITHUB_SECRET=your_github_client_secret

# NextAuth.js Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret

# Database
POSTGRES_URL=your_neon_connection_string
```

**Security Headers:**

```typescript
// In your Next.js configuration
export const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "origin-when-cross-origin",
  },
];
```

### Alternative Architecture: Database Triggers

Instead of handling user creation in application code, consider using database triggers:

**Trigger-Based Approach:**

```sql
-- Create trigger function
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert into User table when new auth.users record is created
  INSERT INTO public."User" (id, email, "creditBalance")
  VALUES (new.id, new.email, '0.00')
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
```

**Pros of Trigger Approach:**

- ✅ **Automatic**: No application code needed
- ✅ **Consistent**: All user creation goes through the same logic
- ✅ **Performance**: No additional database roundtrips in auth flow
- ✅ **Reliable**: Database-level consistency

**Cons of Trigger Approach:**

- ❌ **Less Flexible**: Harder to customize user creation logic
- ❌ **Debugging**: More difficult to debug than application code
- ❌ **Testing**: Harder to test trigger logic
- ❌ **Dependency**: Tightly coupled to Neon Auth schema

### Migration Strategy

If you want to migrate to a different auth approach in the future:

1. **Phase 1: Add Abstract Layer**
   - Create an auth service abstraction
   - Keep current implementation working
   - Add new auth methods behind the abstraction

2. **Phase 2: Gradual Migration**
   - Migrate users in batches
   - Keep both systems running in parallel
   - Validate data consistency

3. **Phase 3: Cleanup**
   - Remove old auth logic
   - Clean up database schema
   - Update documentation

### Performance Optimization

#### 1. Connection Pooling

```typescript
// Optimize database connections for auth operations
const authDb = postgres(process.env.POSTGRES_URL!, {
  max: 5, // Smaller pool for auth operations
  idle_timeout: 10, // Shorter idle timeout
  connect_timeout: 5, // Faster connection timeout
});
```

#### 2. Query Optimization

```typescript
// Use prepared statements for frequent auth queries
const findUserByEmail = db
  .select()
  .from(user)
  .where(eq(user.email, placeholder("email")))
  .prepare("find_user_by_email");

// Usage
const users = await findUserByEmail.execute({ email: token.email });
```

#### 3. Caching Strategy

- Cache user lookup results
- Implement session caching
- Use Redis for session storage in production

### Monitoring and Observability

#### 1. Auth Metrics

```typescript
// Track auth success/failure rates
const authMetrics = {
  successfulLogins: 0,
  failedLogins: 0,
  userCreations: 0,
  sessionCreations: 0,
};

// Log auth events
const logAuthEvent = (event: string, userId?: string) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      userId,
      userAgent: headers().get("user-agent"),
    })
  );
};
```

#### 2. Error Tracking

- Implement comprehensive error logging
- Track auth failure patterns
- Monitor for suspicious activity
- Set up alerts for auth failures

### Conclusion

Your current hybrid approach with custom user synchronization is appropriate for your use case, given the need for custom user fields and business logic. However, consider implementing the recommended optimizations:

1. **Use database constraints** to prevent race conditions
2. **Add proper error handling** and logging
3. **Implement database triggers** as a backup mechanism
4. **Optimize performance** with connection pooling and caching
5. **Add comprehensive monitoring** for auth operations

The trigger-based approach could be implemented alongside your current logic for added reliability, ensuring that users are created even if the JWT callback fails.
