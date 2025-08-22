# Database Configuration and Best Practices

This document outlines our database setup using Drizzle ORM with Neon PostgreSQL, providing guidance for maintaining, extending, and optimizing our database layer.

## Current Database Setup

We use **Drizzle ORM** with the `postgres-js` driver to connect to our **Neon PostgreSQL** database. This setup provides excellent TypeScript support, full PostgreSQL feature compatibility, and robust connection management.

## ⚠️ Important Schema Design Patterns

### Primary Key Best Practices

When designing tables with Drizzle ORM, follow these patterns to avoid migration conflicts:

1. **Single Primary Key**: Use either column-level or table-level primary key, never both
2. **Composite Primary Keys**: Use table-level definition for multi-column keys
3. **NextAuth.js Tables**: Follow the official schema patterns exactly

#### ❌ Wrong - Multiple Primary Key Definitions

```typescript
// This causes "multiple primary keys" error
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(), // ❌ Column-level primary key
    // ... other fields
  },
  (table) => ({
    providerKey: primaryKey({
      // ❌ Also table-level primary key
      columns: [table.provider, table.providerAccountId],
    }),
  })
);
```

#### ✅ Correct - Single Primary Key Definition

```typescript
// Use either column-level OR table-level primary key
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id"), // ✅ No .primaryKey() here
    // ... other fields
  },
  (table) => ({
    providerKey: primaryKey({
      // ✅ Single table-level primary key
      columns: [table.provider, table.providerAccountId],
    }),
  })
);
```

## Schema Migration Troubleshooting

### Common Issues and Solutions

#### Multiple Primary Keys Error

**Error**: `PostgresError: multiple primary keys for table "accounts" are not allowed`

**Cause**: Having both column-level `.primaryKey()` and table-level `primaryKey()` definitions.

**Solution**: Use only one primary key definition pattern per table.

#### RLS Policy Conflicts

**Error**: Various errors related to roles and policies not existing

**Cause**: Defining RLS policies without proper role setup or using non-standard auth functions.

**Solution**: For now, we keep RLS simple and handle authorization at the application level through NextAuth.js callbacks.

#### Migration Generation Issues

**Error**: Drizzle-kit fails to generate migrations or generates conflicting SQL

**Solution**:

1. Delete old migration files: `rm -rf lib/db/migrations/*.sql`
2. Delete meta directory: `rm -rf lib/db/migrations/meta`
3. Generate fresh migration: `pnpm db:generate`
4. Apply migration: `pnpm db:migrate`

### Core Dependencies

```json
{
  "drizzle-orm": "^0.41.0",
  "postgres": "^3.4.7",
  "drizzle-kit": "^0.31.4",
  "@auth/drizzle-adapter": "^1.10.0"
}
```

### Connection Setup

```typescript
// lib/db/queries.ts - Main database connection
const client = postgres(process.env.POSTGRES_URL!);
export const db = drizzle(client);
```

### Environment Configuration

```env
# Database connection string from Neon
POSTGRES_URL="postgresql://username:password@hostname/database?sslmode=require"

# Optional: Additional connection parameters
DATABASE_MAX_CONNECTIONS=10
DATABASE_IDLE_TIMEOUT=20
DATABASE_CONNECT_TIMEOUT=10
```

## Connection Management

### Connection Pooling

Configure connection pooling based on your deployment environment:

```typescript
// Production configuration
const client = postgres(process.env.POSTGRES_URL!, {
  max: 10, // Maximum connections in pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  max_lifetime: 60 * 30, // Close connections after 30 minutes
  connect_timeout: 10, // Connection timeout in seconds
  ssl: { rejectUnauthorized: false }, // Required for Neon
});

// Development configuration
const client = postgres(process.env.POSTGRES_URL!, {
  max: 5, // Smaller pool for development
  idle_timeout: 30, // Longer timeout for debugging
  connect_timeout: 5,
  ssl: { rejectUnauthorized: false },
});
```

### Error Handling

Implement comprehensive error handling for database operations:

```typescript
// lib/db/queries.ts - Error handling pattern
export async function safeDbOperation<T>(
  operation: () => Promise<T>,
  errorMessage: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`Database error: ${errorMessage}`, error);

    // Handle specific PostgreSQL error codes
    if (error instanceof PostgresError) {
      if (error.code === "23505") {
        throw new ChatSDKError("conflict", "Resource already exists");
      }
      if (error.code === "23503") {
        throw new ChatSDKError("not_found", "Referenced resource not found");
      }
    }

    throw new ChatSDKError("database_error", errorMessage);
  }
}
```

## Schema Management

### Current Schema Structure

Our database schema is defined in `lib/db/schema.ts` with the following main tables:

- **User**: Core user profiles with custom fields (creditBalance, etc.)
- **Chat**: Chat conversations with user associations
- **Message**: Individual chat messages
- **Document**: Stored documents and artifacts
- **Vote**: User votes on messages
- **Stream**: Real-time streaming data
- **Accounts/Sessions**: NextAuth.js authentication tables

### Adding New Features

#### 1. Adding New Tables

```typescript
// 1. Define the table in lib/db/schema.ts
export const newFeature = pgTable('NewFeature', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
});

// 2. Export the type
export type NewFeature = InferSelectModel<typeof newFeature>;

// 3. Generate and run migration
pnpm db:generate
pnpm db:migrate
```

#### 2. NextAuth.js Integration Best Practices

Our current setup uses a **custom JWT callback approach** rather than a full database adapter to handle GitHub OAuth user creation:

```typescript
// app/(auth)/auth.ts - Custom user creation logic
callbacks: {
  async jwt({ token, user: authUser, account }) {
    // Handle GitHub OAuth user creation
    if (account?.provider === 'github' && !token.id && token.email) {
      // Check if user exists, create if not
      const existingUsers = await db
        .select()
        .from(user)
        .where(eq(user.email, token.email));

      if (existingUsers.length === 0) {
        // Create new user
        const [newUser] = await db
          .insert(user)
          .values({
            email: token.email,
            creditBalance: '0.00',
          })
          .returning();
        token.id = newUser.id;
      }
    }
    return token;
  },
}
```

**Why this approach?**

- Simpler than full database adapter setup
- Fewer database tables needed
- Direct control over user creation logic
- Easier to customize for application-specific needs

#### 3. Modifying Existing Tables

```typescript
// Add a new column to existing table
export const user = pgTable("User", {
  // ... existing fields
  newField: varchar("newField", { length: 100 }), // New nullable field
});

// For required fields, use migration with default value
export const user = pgTable("User", {
  // ... existing fields
  isActive: boolean("isActive").notNull().default(true),
});
```

#### 4. Drizzle ORM Best Practices

**Column Definitions:**

```typescript
// ✅ Good - Clear, typed column definitions
export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

// ❌ Avoid - Inconsistent or unclear types
export const badTable = pgTable("BadTable", {
  id: text("id"), // Should specify if this is a primary key
  data: json("data"), // Should specify type for better TypeScript support
});
```

**Foreign Key Relationships:**

```typescript
// ✅ Good - Clear foreign key with cascade options
export const chat = pgTable("Chat", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// ✅ Good - Composite foreign key
export const suggestion = pgTable(
  "Suggestion",
  {
    // ... fields
  },
  (table) => ({
    documentFk: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  })
);
```

#### 5. Database Functions and Triggers (Neon Auth Integration)

We maintain a separate directory for SQL functions and triggers that work with Neon Auth + NextAuth.js:

```bash
lib/db/functions/
├── 00_handle_new_user.sql
├── README.md
└── [future functions]
```

**Neon Auth Integration Pattern:**

Our trigger function `handle_new_user()` works with the NextAuth.js OAuth flow:

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

**How it works with Neon Auth:**

1. User authenticates via GitHub OAuth through NextAuth.js
2. NextAuth.js creates an entry in the `accounts` table
3. Our trigger function ensures a corresponding `User` record exists
4. NextAuth.js JWT callbacks populate the email and other profile data
5. The `User` table becomes the single source of truth for application data

**Apply functions:**

```bash
# Apply all SQL functions to database
pnpm db:apply-functions
```

### Migration Workflow

```typescript
// drizzle.config.ts
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
});
```

**Migration Commands:**

```bash
# Generate migration files from schema changes
pnpm db:generate

# Apply migrations to database
pnpm db:migrate

# Reset database (development only)
pnpm db:push

# Check migration status
pnpm db:check
```

**Migration Best Practices:**

1. **Always backup** before applying migrations in production
2. **Test migrations** in development environment first
3. **Commit migration files** to version control
4. **Plan rollback strategy** for critical migrations
5. **Use descriptive names** for migration files

## Query Optimization

### Writing Efficient Queries

```typescript
// Use indexes effectively - ensure frequently queried columns are indexed
// lib/db/schema.ts
export const user = pgTable(
  "User",
  {
    // ... fields
  },
  (table) => ({
    emailIdx: index("email_idx").on(table.email),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  })
);

// Optimize queries with proper selection
const userWithChats = await db
  .select({
    id: user.id,
    email: user.email,
    chatCount: count(chat.id),
  })
  .from(user)
  .leftJoin(chat, eq(user.id, chat.userId))
  .where(eq(user.email, email))
  .groupBy(user.id, user.email);

// Use prepared statements for frequently executed queries
const findUserById = db
  .select()
  .from(user)
  .where(eq(user.id, placeholder("id")))
  .prepare("find_user_by_id");

// Usage
const user = await findUserById.execute({ id: userId });
```

### Connection Management Best Practices

```typescript
// lib/db/queries.ts - Singleton pattern for connection reuse
let dbInstance: ReturnType<typeof drizzle>;

export function getDB() {
  if (!dbInstance) {
    const client = postgres(process.env.POSTGRES_URL!, {
      max: 10,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      ssl: { rejectUnauthorized: false },
    });
    dbInstance = drizzle(client);
  }
  return dbInstance;
}
```

### Caching Strategies

1. **Query Result Caching**: Cache frequently accessed data in Redis
2. **Connection Pooling**: Reuse database connections across requests
3. **Prepared Statements**: Use for frequently executed queries
4. **Database Indexes**: Ensure proper indexing for query performance

## Monitoring and Best Practices

### Database Monitoring

Use Neon's built-in dashboard to monitor:

- **Connection pool utilization**
- **Query execution time**
- **Database size and growth**
- **Error rates and slow queries**

### Structured Logging

```typescript
// lib/db/utils.ts - Database operation logging
export const logDbOperation = (
  operation: string,
  duration: number,
  success: boolean,
  userId?: string
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "database",
      operation,
      duration,
      success,
      userId,
      environment: process.env.NODE_ENV,
    })
  );
};
```

### Security Best Practices

1. **Connection Security**:
   - Always use SSL connections (`sslmode=require`)
   - Store credentials in environment variables
   - Use database users with minimal required permissions
   - Configure IP allowlists in Neon dashboard

2. **Data Security**:
   - Use parameterized queries (Drizzle handles this automatically)
   - Implement Row Level Security (RLS) policies where needed
   - Validate all user inputs before database operations
   - Encrypt sensitive data at rest

3. **Access Control**:
   - Use database roles with specific permissions
   - Implement connection pooling limits
   - Monitor for unusual access patterns

### Working with Neon PostgreSQL

#### Neon-Specific Optimizations

```typescript
// Optimized connection string for Neon
const connectionString = `${process.env
  .POSTGRES_URL!}?sslmode=require&connect_timeout=10`;

// Connection configuration optimized for Neon
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  ssl: { rejectUnauthorized: false }, // Required for Neon
  prepare: false, // Disable prepared statements if experiencing issues
});
```

#### Neon Dashboard Features

1. **Query Performance**: Monitor slow queries and bottlenecks
2. **Connection Pooling**: View connection usage and limits
3. **Database Size**: Track database growth and storage usage
4. **Backup Status**: Monitor automated backup health
5. **Branching**: Use for development and testing environments

## Development Workflow

### Local Development

```bash
# Start local PostgreSQL (if not using Neon for dev)
# Or connect to a Neon development branch

# Generate migration after schema changes
pnpm db:generate

# Apply migrations
pnpm db:migrate

# View database in Drizzle Studio
pnpm db:studio
```

### Testing Database Changes

```typescript
// Use transactions for testing
export async function testDatabaseOperation() {
  const db = getDB();

  await db.transaction(async (tx) => {
    // Test operations here
    await tx.insert(user).values(testUser);
    const result = await tx
      .select()
      .from(user)
      .where(eq(user.email, testEmail));

    // Rollback happens automatically if test fails
    assert(result.length > 0);
  });
}
```

### Row Level Security (RLS)

Row Level Security (RLS) provides fine-grained access control at the database level, ensuring users can only access data they're authorized to see. This is essential for multi-tenant applications or when you need to restrict data access based on user context.

#### When to Use RLS

- **Multi-tenant applications**: Users should only see their own organization's data
- **User-specific data**: Users should only access their own records
- **Role-based access**: Different user types need different data access levels
- **Compliance requirements**: Regulatory requirements for data isolation

#### Basic RLS Setup with Drizzle

1. **Enable RLS on Tables**:

   ```typescript
   // lib/db/schema.ts
   export const chat = pgTable("Chat", {
     id: uuid("id").primaryKey().defaultRandom(),
     createdAt: timestamp("createdAt").notNull(),
     title: text("title").notNull(),
     userId: uuid("userId")
       .notNull()
       .references(() => user.id),
     visibility: varchar("visibility", { enum: ["public", "private"] })
       .notNull()
       .default("private"),
   }).enableRLS(); // Enable RLS on the table
   ```

2. **Define Roles**:

   ```typescript
   // lib/db/schema.ts
   export const admin = pgRole("admin", {
     createRole: true,
     createDb: true,
     inherit: true,
   });

   export const regularUser = pgRole("regular_user").existing();
   ```

3. **Create Policies**:
   ```typescript
   // lib/db/schema.ts
   export const chat = pgTable(
     "Chat",
     {
       id: uuid("id").primaryKey().defaultRandom(),
       createdAt: timestamp("createdAt").notNull(),
       title: text("title").notNull(),
       userId: uuid("userId")
         .notNull()
         .references(() => user.id),
       visibility: varchar("visibility", { enum: ["public", "private"] })
         .notNull()
         .default("private"),
     },
     (table) => [
       // Policy: Users can only see their own chats
       pgPolicy("users_own_chats", {
         to: regularUser,
         for: "select",
         using: sql`auth.uid()::text = ${table.userId}`,
       }),
       // Policy: Users can manage their own chats
       pgPolicy("users_manage_own_chats", {
         to: regularUser,
         for: "all",
         using: sql`auth.uid()::text = ${table.userId}`,
         withCheck: sql`auth.uid()::text = ${table.userId}`,
       }),
     ]
   ).enableRLS();
   ```

#### Neon-Specific RLS Setup

For Neon databases, use the `crudPolicy` helper for simpler policy management:

```typescript
// lib/db/schema.ts
import { crudPolicy } from "drizzle-orm/neon";

export const chat = pgTable(
  "Chat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    visibility: varchar("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("private"),
  },
  (table) => [
    // Simple CRUD policy for regular users
    crudPolicy({
      role: regularUser,
      read: true, // Can read their own chats
      modify: true, // Can create/update/delete their own chats
    }),
  ]
).enableRLS();
```

#### Advanced RLS Patterns

1. **Organization-Based Access**:

   ```typescript
   // Add organization support to your schema
   export const organization = pgTable("Organization", {
     id: uuid("id").primaryKey().defaultRandom(),
     name: varchar("name", { length: 255 }).notNull(),
   });

   export const user = pgTable("User", {
     // ... existing fields
     organizationId: uuid("organizationId").references(() => organization.id),
   });

   export const chat = pgTable(
     "Chat",
     {
       // ... existing fields
       organizationId: uuid("organizationId").references(() => organization.id),
     },
     (table) => [
       pgPolicy("org_access", {
         to: regularUser,
         for: "all",
         using: sql`EXISTS (
         SELECT 1 FROM "User"
         WHERE "User".id::text = auth.uid()::text
         AND "User"."organizationId" = ${table.organizationId}
       )`,
       }),
     ]
   ).enableRLS();
   ```

2. **Role-Based Access with Permissions**:

   ```typescript
   export const role = pgTable("Role", {
     id: uuid("id").primaryKey().defaultRandom(),
     name: varchar("name", { length: 50 }).notNull(),
     permissions: jsonb("permissions").$type<Record<string, boolean>>(),
   });

   export const user = pgTable("User", {
     // ... existing fields
     roleId: uuid("roleId").references(() => role.id),
   });

   export const document = pgTable(
     "Document",
     {
       // ... existing fields
       userId: uuid("userId").references(() => user.id),
     },
     (table) => [
       pgPolicy("role_based_access", {
         to: regularUser,
         for: "select",
         using: sql`EXISTS (
         SELECT 1 FROM "User" u
         JOIN "Role" r ON u."roleId" = r.id
         WHERE u.id::text = auth.uid()::text
         AND r.permissions ->> 'can_view_documents' = 'true'
       )`,
       }),
     ]
   ).enableRLS();
   ```

#### RLS Best Practices

1. **Test RLS Policies**:

   ```typescript
   // Test RLS by setting different user contexts
   export async function testRLSPolicies() {
     // Set context for user A
     await db.execute(sql`SELECT set_config('auth.uid', 'user-a-id', false)`);
     const userAChats = await db.select().from(chat);

     // Set context for user B
     await db.execute(sql`SELECT set_config('auth.uid', 'user-b-id', false)`);
     const userBChats = await db.select().from(chat);

     // Verify they don't see each other's data
     console.log("User A chats:", userAChats.length);
     console.log("User B chats:", userBChats.length);
   }
   ```

2. **Performance Considerations**:
   - RLS policies add overhead to queries
   - Ensure proper indexing on columns used in policies
   - Consider policy complexity vs. performance trade-offs
   - Use `EXPLAIN ANALYZE` to check query performance with RLS

3. **Migration Strategy**:
   When adding RLS to existing tables, run migrations carefully:

   ```bash
   # Generate migration with new RLS policies
   pnpm db:generate

   # Test in staging first
   pnpm db:migrate

   # Monitor performance after deployment
   ```

#### Common RLS Patterns

1. **User-Owned Resources**:

   ```typescript
   pgPolicy("user_owned", {
     to: regularUser,
     for: "all",
     using: sql`auth.uid()::text = ${table.userId}`,
   });
   ```

2. **Organization Scoping**:

   ```typescript
   pgPolicy("org_scoped", {
     to: regularUser,
     for: "all",
     using: sql`EXISTS (
       SELECT 1 FROM "User"
       WHERE "User".id::text = auth.uid()::text
       AND "User"."organizationId" = ${table.organizationId}
     )`,
   });
   ```

3. **Hierarchical Access**:
   ```typescript
   pgPolicy("hierarchical", {
     to: regularUser,
     for: "select",
     using: sql`auth.uid()::text = ${table.userId} OR
              auth.uid()::text = ${table.managerId}`,
   });
   ```

#### Monitoring RLS

```typescript
// Check active RLS policies
export async function monitorRLSPolicies() {
  const policies = await db.execute(sql`
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  `);

  console.log("Active RLS Policies:", policies);
}
```

### Production Deployment

1. **Pre-deployment checklist**:
   - Run migrations in staging environment first
   - Backup production database
   - Test all critical database operations
   - Verify connection pool settings
   - Test RLS policies with real user data

2. **Deployment process**:

   ```bash
   # Apply migrations
   pnpm db:migrate

   # Verify database health
   pnpm db:check

   # Test RLS policies
   pnpm run test:rls
   ```

## Current Database Schema

### Core Tables

#### User Table

```typescript
export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }), // For credentials auth
  creditBalance: varchar("creditBalance", { length: 20 })
    .notNull()
    .default("0.00"),
});
```

#### NextAuth.js Tables

```typescript
// OAuth account connections
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id"),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 255 }).notNull(),
    providerAccountId: varchar("providerAccountId", { length: 255 }).notNull(),
    // OAuth tokens
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: bigint("expires_at", { mode: "number" }),
    id_token: text("id_token"),
    scope: text("scope"),
    session_state: text("session_state"),
    token_type: text("token_type"),
  },
  (table) => ({
    // Composite primary key for OAuth providers
    providerProviderAccountIdIdx: primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
  })
);

// User sessions
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
  sessionToken: varchar("sessionToken", { length: 255 }).notNull().unique(),
});

// Email verification tokens
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

#### Application Tables

```typescript
// Chat conversations
export const chat = pgTable("Chat", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("createdAt").notNull(),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

// Chat messages
export const message = pgTable("Message", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

// User votes on messages
export const vote = pgTable("Vote", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => message.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  chatId: uuid("chatId"),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Document artifacts with composite primary key
export const document = pgTable(
  "Document",
  {
    id: uuid("id").notNull().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    kind: varchar("text", {
      enum: ["text", "code", "image", "sheet", "canvas"],
    })
      .notNull()
      .default("text"),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    documentCompoundKey: primaryKey({
      columns: [table.id, table.createdAt],
    }),
  })
);

// Document suggestions
export const suggestion = pgTable(
  "Suggestion",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    documentId: uuid("documentId").notNull(),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    description: text("description"),
    isResolved: boolean("isResolved").notNull().default(false),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    documentFk: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  })
);

// Real-time streams
export const stream = pgTable(
  "Stream",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    chatFk: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  })
);
```

## Conclusion

This document serves as your guide for working with our Drizzle ORM + Neon PostgreSQL setup. Follow these practices to maintain database performance, security, and reliability as you add new features and scale your application.

### Key Takeaways

1. **Always use single primary key definitions** - never mix column-level and table-level primary keys
2. **Follow NextAuth.js schema patterns exactly** for authentication tables
3. **Use custom JWT callbacks** for simpler OAuth user creation instead of full database adapters
4. **Keep RLS simple** or handle authorization at the application level
5. **Clean slate migrations** when encountering conflicts - delete old files and regenerate
