# ID Management System

This document describes the centralized ID management system implemented to ensure consistent, type-safe ID generation across the entire application.

## Overview

The ID management system provides:

- **Database-safe UUIDs**: Always generates proper UUID format for database operations
- **Human-readable references**: Optional reference IDs for task coordination and debugging
- **Type safety**: Ensures correct ID usage for different entity types
- **Centralized tracking**: Registry for debugging and cleanup
- **Legacy compatibility**: Seamless migration from existing UUID generation

## Architecture

### Core Components

#### 1. IDManager Class (`lib/id-management.ts`)

Singleton class that manages all ID generation and tracking.

```typescript
const idManager = IDManager.getInstance();
const config = idManager.generateFor("document", {
  referenceId: "vietnam-trip-planning",
  metadata: { title: "Vietnam Trip Planning", kind: "canvas" },
});
```

#### 2. Entity-Specific Generators

High-level functions for common ID generation patterns:

- `generateChatIds()` - Chat, message, and stream IDs
- `generateDocumentIds()` - Document and suggestion IDs
- `generateTaskIds()` - Task, document, and agent IDs
- `generateUserIds()` - User account IDs

#### 3. Utility Functions

Helper functions for validation and compatibility:

- `isValidUUID()` - Validate UUID format
- `validateDatabaseId()` - Ensure database compatibility
- `ensureValidDatabaseId()` - Legacy compatibility helper
- `extractReference()` - Extract meaningful references from IDs

## Entity Types

The system supports the following entity types:

| Entity Type  | Description                | Usage                           |
| ------------ | -------------------------- | ------------------------------- |
| `chat`       | Chat conversations         | Main chat containers            |
| `message`    | Individual messages        | User/assistant messages         |
| `document`   | Stored documents/artifacts | Canvas, text, code artifacts    |
| `task`       | Task definitions           | Project planning and execution  |
| `agent`      | AI agents                  | Task execution agents           |
| `stream`     | Streaming connections      | Real-time data streams          |
| `user`       | User accounts              | Authentication and profiles     |
| `suggestion` | Document suggestions       | Content improvement suggestions |

## Usage Patterns

### 1. Canvas/Task Creation

```typescript
import { generateTaskIds } from "@/lib/id-management";

// Generate IDs for a new task
const ids = generateTaskIds("Vietnam Trip Planning", "vietnam-trip-planning");

// Use database ID for storage
await saveDocument({
  id: ids.document.databaseId, // UUID format
  title: "Vietnam Trip Planning",
  kind: "canvas",
});

// Use reference ID for coordination
const taskReference = ids.task.referenceId; // 'vietnam-trip-planning'
```

### 2. Chat Management

```typescript
import { generateChatIds } from "@/lib/id-management";

const chatIds = generateChatIds("Project Discussion");

// Create chat with database ID
await saveChat({
  id: chatIds.chat.databaseId,
  title: "Project Discussion",
});

// Generate message IDs as needed
const messageId = chatIds.generateMessageId().databaseId;
```

### 3. Document Creation

```typescript
import { generateDocumentIds } from "@/lib/id-management";

const ids = generateDocumentIds("API Documentation", "text");

await createDocument({
  id: ids.document.databaseId,
  title: "API Documentation",
  kind: "text",
});
```

## Integration Points

### 1. Tools Integration

Updated all AI tools to use the new ID management:

```typescript
// lib/ai/tools/create-task.ts
const ids = generateTaskIds(title, taskId);

// lib/ai/tools/create-document.ts
const ids = generateDocumentIds(title, kind);
```

### 2. Chat API Integration

```typescript
// app/(chat)/api/chat/route.ts
const chatIds = generateChatIds();
const streamId = chatIds.generateStreamId().databaseId;
```

### 3. Database Layer

All database operations receive proper UUID format:

```typescript
// lib/db/queries.ts - saveDocument function
export async function saveDocument({
  id, // Always receives valid UUID
  title,
  kind,
  content,
  userId,
}: {
  id: string; // Validated UUID format
  // ...
});
```

## Benefits

### 1. **Database Compatibility**

- Eliminates UUID format errors
- Ensures consistent primary key generation
- Prevents `invalid input syntax for type uuid` errors

### 2. **Enhanced Debugging**

- Centralized ID tracking
- Rich metadata for troubleshooting
- Reference ID mapping for human-readable coordination

### 3. **Type Safety**

- Entity-specific ID generation
- Compile-time validation
- Prevents ID misuse across entity types

### 4. **Performance Optimization**

- Singleton pattern reduces object creation
- Optional cleanup for memory management
- Efficient ID lookup and tracking

### 5. **Developer Experience**

- Simple, intuitive API
- Legacy compatibility
- Comprehensive logging

## Migration Guide

### Before (Legacy)

```typescript
// Old pattern - prone to UUID errors
const id = taskId || generateUUID();
await saveDocument({ id, title, kind, content, userId });
```

### After (ID Management)

```typescript
// New pattern - database-safe and trackable
const ids = generateTaskIds(title, taskId);
await saveDocument({
  id: ids.document.databaseId,
  title,
  kind,
  content,
  userId,
});
```

## Error Prevention

The system prevents common ID-related errors:

1. **UUID Format Errors**: Always generates proper UUID format
2. **ID Collisions**: Uses crypto-random UUID generation
3. **Type Mismatches**: Entity-specific ID generation
4. **Memory Leaks**: Automatic cleanup of old entries
5. **Debugging Difficulties**: Rich metadata and logging

## Configuration

### Environment Variables

None required - the system works out of the box.

### Cleanup Configuration

```typescript
// Automatic cleanup every hour (configurable)
setInterval(
  () => {
    IDManager.getInstance().cleanup();
  },
  60 * 60 * 1000
);
```

### Debug Monitoring

```typescript
// Get registry statistics
const stats = IDManager.getInstance().getStats();
console.log("ID Registry:", stats);
```

## Best Practices

### 1. **Use Entity-Specific Generators**

```typescript
// ✅ Good
const ids = generateTaskIds(title, referenceId);

// ❌ Avoid
const idManager = IDManager.getInstance();
const config = idManager.generateFor("task");
```

### 2. **Always Use Database IDs for Storage**

```typescript
// ✅ Good
await saveDocument({ id: ids.document.databaseId });

// ❌ Avoid
await saveDocument({ id: referenceId }); // Not UUID format
```

### 3. **Use Reference IDs for Coordination**

```typescript
// ✅ Good
const taskRef = ids.task.referenceId; // Human-readable

// ❌ Avoid
const taskRef = ids.task.databaseId; // UUID, hard to read
```

### 4. **Include Metadata for Debugging**

```typescript
// ✅ Good
const ids = generateDocumentIds(title, kind);
// Automatically includes title, kind, createdAt

// ❌ Avoid
const id = generateUUID(); // No context
```

## Troubleshooting

### Common Issues

1. **"Invalid UUID format" Errors**
   - **Cause**: Using reference ID for database operations
   - **Solution**: Use `ids.document.databaseId` instead of `ids.document.referenceId`

2. **"ID not found" Errors**
   - **Cause**: Looking up ID after cleanup
   - **Solution**: Generate fresh ID or extend cleanup interval

3. **Memory Growth**
   - **Cause**: ID registry not being cleaned up
   - **Solution**: Ensure cleanup interval is running

### Debug Commands

```typescript
// Check registry status
const idManager = IDManager.getInstance();
console.log("Registry stats:", idManager.getStats());

// Find ID by reference
const config = idManager.findByReference("vietnam-trip-planning", "task");
console.log("Found config:", config);

// Validate UUID
import { isValidUUID } from "@/lib/id-management";
console.log("Valid UUID:", isValidUUID(someId));
```

## Future Enhancements

1. **Distributed ID Generation**: Support for multi-instance deployments
2. **ID Analytics**: Track ID usage patterns and performance
3. **Custom Validators**: Entity-specific ID validation rules
4. **Backup/Restore**: ID registry persistence and recovery
5. **Integration Testing**: Automated ID format validation

## Conclusion

The ID management system provides a robust foundation for consistent, safe, and trackable ID generation across the entire application. It eliminates UUID-related errors while maintaining developer productivity and system performance.

For questions or issues, refer to the troubleshooting section or check the implementation in `lib/id-management.ts`.
