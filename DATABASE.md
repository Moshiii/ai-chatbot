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

## Core Tables

### 1. User Table

Stores user account information and credit balances for agent execution payments.

```sql
CREATE TABLE "User" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(64) NOT NULL,
  password VARCHAR(64),
  creditBalance VARCHAR(20) NOT NULL DEFAULT '0.00'
);
```

**Fields:**
- `id`: Unique user identifier (UUID)
- `email`: User email address
- `password`: Hashed password (optional for OAuth users)
- `creditBalance`: User's credit balance for paying agents (stored as string for precision)

**Usage:**
- Authentication via Auth.js
- Credit management for agent execution payments
- User isolation for chats and documents

### 2. Chat Table

Represents individual chat sessions between users and AI models.

```sql
CREATE TABLE "Chat" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  createdAt TIMESTAMP NOT NULL,
  title TEXT NOT NULL,
  userId UUID NOT NULL REFERENCES "User"(id),
  visibility VARCHAR CHECK (visibility IN ('public', 'private')) NOT NULL DEFAULT 'private'
);
```

**Fields:**
- `id`: Unique chat identifier
- `createdAt`: Chat creation timestamp
- `title`: Chat display title
- `userId`: Owner of the chat
- `visibility`: Public/private access control

**Usage:**
- Chat organization and history
- Public chat sharing functionality
- User-specific chat isolation

### 3. Message Table

Stores chat messages with support for multimodal content parts.

```sql
CREATE TABLE "Message" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatId UUID NOT NULL REFERENCES "Chat"(id),
  role VARCHAR NOT NULL,
  parts JSON NOT NULL,
  attachments JSON NOT NULL,
  createdAt TIMESTAMP NOT NULL
);
```

**Fields:**
- `id`: Unique message identifier
- `chatId`: Parent chat reference
- `role`: Message role (`user`, `assistant`, `system`)
- `parts`: Array of message parts (text, images, files, tool calls)
- `attachments`: File attachments metadata
- `createdAt`: Message timestamp

**Parts Structure:**
```typescript
parts: Array<{
  type: 'text' | 'image' | 'file' | 'tool-call' | 'tool-result';
  text?: string;           // For text parts
  image?: string;          // Base64 image data
  mimeType?: string;       // File MIME type
  toolCallId?: string;     // Tool call identifier
  toolName?: string;       // Tool name
  args?: object;           // Tool arguments
  result?: any;            // Tool result
}>
```

### 4. Document Table

Stores artifacts generated during conversations (code, text, images, sheets, canvas).

```sql
CREATE TABLE "Document" (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  createdAt TIMESTAMP NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  kind VARCHAR CHECK (kind IN ('text', 'code', 'image', 'sheet', 'canvas')) NOT NULL DEFAULT 'text',
  userId UUID NOT NULL REFERENCES "User"(id),
  PRIMARY KEY (id, createdAt)
);
```

**Fields:**
- `id`: Document identifier
- `createdAt`: Version timestamp
- `title`: Document title
- `content`: Document content (JSON for complex types)
- `kind`: Document type
- `userId`: Document owner

**Document Types:**
- `text`: Plain text documents
- `code`: Code files with syntax highlighting
- `image`: Generated or uploaded images
- `sheet`: Spreadsheet data
- `canvas`: Interactive task decomposition interface

**Canvas Content Structure:**
```typescript
// Stored as JSON string in content field
{
  taskId?: string,  // Python agent task ID
  tasks: Array<{
    id: string,
    title: string,
    description: string,
    status: 'pending' | 'in-progress' | 'completed' | 'recruiting'
  }>,
  agents: Array<{
    id: string,
    name: string,
    description: string,
    capabilities: string[],
    taskId?: string,
    pricingUsdt?: number,
    walletAddress?: string
  }>,
  responses: Array<{
    id: string,
    agentId: string,
    content: string,
    timestamp: string  // ISO timestamp
  }>,
  summary: {
    id: string,
    content: string,
    timestamp: string
  } | null
}
```

**Versioning:**
- Composite primary key `(id, createdAt)` enables document version history
- Multiple versions of the same document can coexist
- Version navigation supported in UI

### 5. Suggestion Table

Stores editing suggestions for documents with approval workflow.

```sql
CREATE TABLE "Suggestion" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documentId UUID NOT NULL,
  documentCreatedAt TIMESTAMP NOT NULL,
  originalText TEXT NOT NULL,
  suggestedText TEXT NOT NULL,
  description TEXT,
  isResolved BOOLEAN NOT NULL DEFAULT false,
  userId UUID NOT NULL REFERENCES "User"(id),
  createdAt TIMESTAMP NOT NULL,
  FOREIGN KEY (documentId, documentCreatedAt) REFERENCES "Document"(id, createdAt)
);
```

**Fields:**
- `id`: Unique suggestion identifier
- `documentId`, `documentCreatedAt`: Document version reference
- `originalText`: Text to be replaced
- `suggestedText`: Proposed replacement
- `description`: Explanation of the suggestion
- `isResolved`: Whether suggestion has been applied/rejected
- `userId`: User who created the suggestion
- `createdAt`: Suggestion timestamp

**Usage:**
- AI-generated document improvements
- Collaborative editing workflow
- Change tracking and approval

### 6. Vote Table

User feedback on message quality for model improvement.

```sql
CREATE TABLE "Vote" (
  chatId UUID NOT NULL REFERENCES "Chat"(id),
  messageId UUID NOT NULL REFERENCES "Message"(id),
  isUpvoted BOOLEAN NOT NULL,
  PRIMARY KEY (chatId, messageId)
);
```

**Fields:**
- `chatId`: Chat context
- `messageId`: Target message
- `isUpvoted`: True for upvote, false for downvote

**Usage:**
- User feedback collection
- Model performance tracking
- Quality assurance

### 7. Stream Table

Manages streaming state for resumable conversations.

```sql
CREATE TABLE "Stream" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatId UUID NOT NULL REFERENCES "Chat"(id),
  createdAt TIMESTAMP NOT NULL
);
```

**Fields:**
- `id`: Stream identifier
- `chatId`: Associated chat
- `createdAt`: Stream start time

**Usage:**
- Resumable streaming sessions
- State management for long-running AI operations
- Session recovery after disconnection

## Relationships

### Entity Relationship Diagram

```
User (1) ----< (N) Chat
User (1) ----< (N) Document
User (1) ----< (N) Suggestion

Chat (1) ----< (N) Message
Chat (1) ----< (N) Vote
Chat (1) ----< (N) Stream

Document (1) ----< (N) Suggestion

Message (1) ----< (1) Vote
```

### Key Relationships

1. **User → Chat**: One-to-many (users can have multiple chats)
2. **Chat → Message**: One-to-many (chats contain multiple messages)
3. **User → Document**: One-to-many (users create multiple documents)
4. **Document → Suggestion**: One-to-many (documents can have multiple suggestions)
5. **Chat + Message → Vote**: One-to-one (each message can have one vote per chat)

## Migration History

The database uses SQL migrations for schema evolution:

1. `0000_keen_devos.sql` - Initial schema
2. `0001_sparkling_blue_marvel.sql` - Message parts migration
3. `0002_wandering_riptide.sql` - Document improvements
4. `0003_cloudy_glorian.sql` - Vote system updates
5. `0004_odd_slayback.sql` - Stream management
6. `0005_wooden_whistler.sql` - Suggestion system
7. `0006_marvelous_frog_thor.sql` - User enhancements
8. `0007_add_canvas_enum.sql` - Canvas document type
9. `0008_add_credit_balance.sql` - User credit system
10. `0009_add_chat_id_to_document.sql` - Document-chat linking

## Data Access Patterns

### Common Queries

1. **Get user chats with latest message:**
```sql
SELECT c.*, m.content as latest_message
FROM "Chat" c
LEFT JOIN "Message" m ON m.chatId = c.id
WHERE c.userId = $1
ORDER BY c.createdAt DESC;
```

2. **Get document versions:**
```sql
SELECT * FROM "Document"
WHERE id = $1
ORDER BY createdAt DESC;
```

3. **Get canvas data with metadata:**
```sql
SELECT content FROM "Document"
WHERE id = $1 AND kind = 'canvas'
ORDER BY createdAt DESC
LIMIT 1;
```

4. **Get pending suggestions:**
```sql
SELECT * FROM "Suggestion"
WHERE documentId = $1 AND isResolved = false
ORDER BY createdAt ASC;
```

### Performance Considerations

1. **Indexes**: Primary keys automatically indexed
2. **Foreign Keys**: Indexed for join performance
3. **Composite Keys**: Optimized for version queries
4. **JSON Fields**: Consider GIN indexes for complex JSON queries

## Security & Privacy

1. **User Isolation**: All user data is isolated by `userId`
2. **Chat Visibility**: Public/private access control
3. **Document Ownership**: Users can only access their own documents
4. **Vote Privacy**: Votes are anonymous but tracked per user
5. **Credit Security**: Credit balance stored as string to prevent precision issues

## Backup & Maintenance

1. **Migrations**: Automatic during deployment via `pnpm build`
2. **Data Retention**: No automatic cleanup (implement as needed)
3. **Analytics**: Vote and usage data available for analysis
4. **Canvas State**: Complex JSON data requires careful backup procedures

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

This database schema supports the full feature set of the AI chatbot application, including advanced features like canvas-based task decomposition, agent coordination, and multimodal conversations.