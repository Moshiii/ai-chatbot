# AI Chatbot Database Documentation

This document provides a comprehensive overview of the database schema for the AI Chatbot application, built with PostgreSQL and Drizzle ORM.

## Overview

The database is designed to support a sophisticated AI chatbot with the following key features:

- User authentication and credit management
- Multi-model chat conversations with message parts
- Document artifacts (text, code, images, sheets, canvas)
- Canvas-based task decomposition and agent coordination
- Voting system for message quality
- Suggestion system for document improvements
- Streaming state management

## Database Technology

- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Migration System**: SQL migrations in `/lib/db/migrations/`
- **Schema Definition**: TypeScript schema in `/lib/db/schema.ts`

## Naming Conventions

### Table Naming

We follow **lowercase singular naming** for all database tables to maintain consistency and readability:

```typescript
// ✅ Correct - Lowercase singular
export const user = pgTable('user', { ... });
export const chat = pgTable('chat', { ... });
export const message = pgTable('message', { ... });

// ❌ Avoid - PascalCase or plural
export const User = pgTable('User', { ... });
export const Users = pgTable('Users', { ... });
```

### Column Naming

We use **snake_case** for multi-word column names:

```typescript
// ✅ Correct - snake_case for multi-word columns
userId: uuid("user_id");
createdAt: timestamp("created_at");
creditBalance: varchar("credit_balance");

// ❌ Avoid - camelCase for database columns
userId: uuid("userId"); // Should be 'user_id'
createdAt: timestamp("createdAt"); // Should be 'created_at'
```

### Index Naming

Indexes follow the pattern: `{table}_{column}_idx`

```typescript
// ✅ Correct - Consistent index naming
index("chat_user_id_idx").on(table.userId);
index("message_chat_id_idx").on(table.chatId);
```

## Core Tables

### 1. User Table

Stores user account information and credit balances for agent execution payments.

```sql
CREATE TABLE "user" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(64) NOT NULL,
  password VARCHAR(64),
  credit_balance VARCHAR(20) NOT NULL DEFAULT '0.00'
);
```

### 2. Chat Table

Represents individual chat sessions between users and AI models.

```sql
CREATE TABLE "chat" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP NOT NULL,
  title TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES "user"(id),
  visibility VARCHAR CHECK (visibility IN ('public', 'private')) NOT NULL DEFAULT 'private'
);
```

### 3. Message Table

Stores chat messages with support for multimodal content parts.

```sql
CREATE TABLE "message" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES "chat"(id),
  role VARCHAR NOT NULL,
  parts JSON NOT NULL,
  attachments JSON NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

### 4. Document Table

Stores artifacts generated during conversations (code, text, images, sheets, canvas).

```sql
CREATE TABLE "document" (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMP NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  kind VARCHAR CHECK (kind IN ('text', 'code', 'image', 'sheet', 'canvas')) NOT NULL DEFAULT 'text',
  user_id UUID NOT NULL REFERENCES "user"(id),
  task_ids JSONB,
  PRIMARY KEY (id, created_at)
);
```

### 5. Suggestion Table

Stores editing suggestions for documents with approval workflow.

```sql
CREATE TABLE "suggestion" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  document_created_at TIMESTAMP NOT NULL,
  original_text TEXT NOT NULL,
  suggested_text TEXT NOT NULL,
  description TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  user_id UUID NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (document_id, document_created_at) REFERENCES "document"(id, created_at)
);
```

### 6. Vote Table

User feedback on message quality for model improvement.

```sql
CREATE TABLE "vote" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES "message"(id),
  user_id UUID NOT NULL REFERENCES "user"(id),
  chat_id UUID,
  value TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 7. Stream Table

Manages streaming state for resumable conversations.

```sql
CREATE TABLE "stream" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES "chat"(id),
  created_at TIMESTAMP NOT NULL
);
```

### 8. Account Table (NextAuth.js)

OAuth account connections with composite primary key.

```sql
CREATE TABLE "account" (
  id SERIAL,
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT,
  PRIMARY KEY (provider, provider_account_id)
);
```

### 9. Session Table (NextAuth.js)

User session management.

```sql
CREATE TABLE "session" (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires TIMESTAMP NOT NULL,
  session_token VARCHAR(255) NOT NULL UNIQUE
);
```

### 10. Verification Token Table (NextAuth.js)

Email verification tokens.

```sql
CREATE TABLE "verification_token" (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires TIMESTAMP NOT NULL,
  PRIMARY KEY (identifier, token)
);
```

### 11. Task Table (A2A)

Asynchronous task management for the Agent-to-Agent protocol.

```sql
CREATE TABLE "task" (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted',
  status_message TEXT,
  result JSONB,
  webhook_token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

## Relationships

### Entity Relationship Diagram

```
user (1) ----< (N) account
user (1) ----< (N) session
user (1) ----< (N) chat
user (1) ----< (N) document
user (1) ----< (N) suggestion
user (1) ----< (N) vote

chat (1) ----< (N) message
chat (1) ----< (N) stream
chat (1) ----< (N) vote

message (1) ----< (N) vote

document (1) ----< (N) suggestion
```

## Schema Design Patterns

### Primary Key Best Practices

When designing tables with Drizzle ORM, follow these patterns to avoid migration conflicts:

1. **Single Primary Key**: Use either column-level or table-level primary key, never both
2. **Composite Primary Keys**: Use table-level definition for multi-column keys
3. **NextAuth.js Tables**: Follow the official schema patterns exactly

#### ✅ Correct - Single Primary Key Definition

```typescript
// Use either column-level OR table-level primary key
export const account = pgTable(
  "account",
  {
    id: serial("id"), // No .primaryKey() here
    // ... other fields
  },
  (table) => ({
    providerKey: primaryKey({
      // Single table-level primary key
      columns: [table.provider, table.providerAccountId],
    }),
  })
);
```

## Migration History

The database uses SQL migrations for schema evolution:

1. `0000_freezing_master_mold.sql` - Initial schema with lowercase naming

## Data Access Patterns

### Common Queries

1. **Get user chats with latest message:**

```sql
SELECT c.*, m.content as latest_message
FROM "chat" c
LEFT JOIN "message" m ON m.chat_id = c.id
WHERE c.user_id = $1
ORDER BY c.created_at DESC;
```

2. **Get document versions:**

```sql
SELECT * FROM "document"
WHERE id = $1
ORDER BY created_at DESC;
```

3. **Get canvas data with metadata:**

```sql
SELECT content FROM "document"
WHERE id = $1 AND kind = 'canvas'
ORDER BY created_at DESC
LIMIT 1;
```

4. **Get pending suggestions:**

```sql
SELECT * FROM "suggestion"
WHERE document_id = $1 AND is_resolved = false
ORDER BY created_at ASC;
```

## Development Commands

- `pnpm db:migrate` - Run pending migrations
- `pnpm db:studio` - Open Drizzle Studio for database inspection
- `pnpm db:generate` - Generate new migration files
- `pnpm db:push` - Push schema changes directly (dev only)
- `pnpm db:pull` - Pull schema from database
- `pnpm db:check` - Validate migration files

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `POSTGRES_URL` - Alternative connection string format

## Best Practices

### Drizzle ORM Best Practices

**Column Definitions:**

```typescript
// ✅ Good - Clear, typed column definitions
export const user = pgTable("user", {
  id: uuid("id")
    .primaryKey()
    .notNull()
    .$defaultFn(() => crypto.randomUUID()),
  email: varchar("email", { length: 64 }).notNull(),
  isActive: boolean("is_active")
    .notNull()
    .$default(() => true),
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

// ❌ Avoid - Inconsistent or unclear types
export const badTable = pgTable("bad_table", {
  id: text("id"), // Should specify if this is a primary key
  data: json("data"), // Should specify type for better TypeScript support
});
```

### Migration Best Practices

1. **Always backup** before applying migrations in production
2. **Test migrations** in development environment first
3. **Commit migration files** to version control
4. **Plan rollback strategy** for critical migrations
5. **Use descriptive names** for migration files

### Development Workflow

```bash
# Generate migration after schema changes
pnpm db:generate

# Apply migrations
pnpm db:migrate

# View database in Drizzle Studio
pnpm db:studio
```

## Current Schema Structure

Our database schema is defined in `lib/db/schema.ts` with the following main tables:

- **user**: Core user profiles with custom fields (credit_balance, etc.)
- **chat**: Chat conversations with user associations
- **message**: Individual chat messages
- **document**: Stored documents and artifacts
- **suggestion**: Document editing suggestions
- **vote**: User votes on messages
- **stream**: Real-time streaming data
- **account/session/verification_token**: NextAuth.js authentication tables
- **task**: A2A asynchronous task management

This database schema supports the full feature set of the AI chatbot application, including advanced features like canvas-based task decomposition, agent coordination, and multimodal conversations.

## Key Takeaways

1. **Use lowercase singular table names** consistently
2. **Use snake_case for multi-word column names** in database schema
3. **Always use single primary key definitions** - never mix column-level and table-level primary keys
4. **Follow NextAuth.js schema patterns exactly** for authentication tables
5. **Use custom JWT callbacks** for simpler OAuth user creation instead of full database adapters
6. **Clean slate migrations** when encountering conflicts - delete old files and regenerate
