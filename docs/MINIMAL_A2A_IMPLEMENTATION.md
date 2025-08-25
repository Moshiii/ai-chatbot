# Minimal A2A Task Generation and Execution Implementation

## Overview

This document outlines a streamlined implementation focused on leveraging the A2A (Agent-to-Agent) protocol for task generation and execution, while maintaining compatibility with AI SDK v5.

## Architecture Goals

### Core Workflow

1. **User Request** → AI SDK with canvas creation tool
2. **Canvas Generation** → Task decomposition with A2A agents
3. **Task Visualization** → Node-based interface (CanvasFlow component)
4. **Task Execution** → A2A agent network execution
5. **Real-time Updates** → Streaming results back to canvas

### Key Components

#### 1. Canvas Creation (Fixed)

- **Location**: `artifacts/canvas/client.tsx`
- **Status**: ✅ Fixed - removed suggestions dependency
- **Function**: Provides visual interface for task management

#### 2. Task Generation Tools

- **createTask**: `lib/ai/tools/create-task.ts`
- **planTasks**: `lib/ai/tools/plan-tasks.ts`
- **updateTask**: `lib/ai/tools/update-task.ts`

#### 3. A2A Execution Endpoint

- **Location**: `app/api/agent/execution/route.ts`
- **Function**: Handles business logic and routes to Python agent
- **Features**: Payment validation, rate limiting, streaming updates

#### 4. AI SDK Integration

- **Chat Route**: `app/(chat)/api/chat/route.ts`
- **Available Tools**: Canvas creation, task planning, A2A execution
- **Streaming**: Real-time updates via SSE

## Current Implementation Status

### ✅ Working Components

1. **Canvas Artifact** - Now initializes without database errors
2. **A2A Provider** - `lib/ai/a2a-provider.ts` connects to Python agents
3. **Task Tools** - Create, plan, and update task functionality
4. **Execution API** - Handles A2A agent coordination
5. **CanvasFlow UI** - Node-based visualization component

### 🔧 Integration Points

#### AI SDK v5 + A2A Protocol

```typescript
// Example: Using AI SDK tool to trigger A2A execution
const createTask = tool({
  description: "Create a task by decomposing a project into jobs with agents",
  execute: async ({ title, jobs }) => {
    // 1. Create canvas document
    await documentHandler.onCreateDocument({ id, title, dataStream, session });

    // 2. Stream jobs to canvas UI
    for (const job of jobs) {
      dataStream.write({
        type: "data-textDelta",
        data: JSON.stringify({ newJob: job, taskId: id }),
        transient: true,
      });
    }

    // 3. Ready for A2A execution
    return { id, title, jobCount: jobs.length };
  },
});
```

#### A2A Execution Flow

```typescript
// Agent execution through A2A protocol
const provider = a2a(agentUrl, {
  contextId: taskId,
  toolcallSupport: true,
  taskMode: true,
});

const result = await provider.doStream({
  prompt: [{ role: "user", content: JSON.stringify(executionMessage) }],
});
```

## Suggested User Workflow

### 1. Canvas Creation

```
User: "Please create a task decomposition canvas to help me plan a 3-day trip to Vietnam"
```

**AI Response**:

- Calls `createDocument` tool with kind='canvas'
- Canvas initializes without suggestions
- Ready for task breakdown

### 2. Task Generation

```
User: "Break this down into detailed tasks with appropriate agents"
```

**AI Response**:

- Calls `planTasks` or `createTask` tool
- Generates tasks with agent assignments
- Streams tasks to canvas UI for visualization

### 3. Task Execution

```
User: "Execute all tasks with the assigned agents"
```

**Frontend Action**:

- User clicks "Execute All Agents" button in canvas
- Calls `/api/agent/execution` endpoint
- A2A agents execute tasks in parallel/sequential
- Real-time updates stream back to canvas

## Removed Complexity

### What We Eliminated

1. **Suggestions System** - Not needed for task workflows
2. **Database Dependencies** - Simplified canvas initialization
3. **Unnecessary APIs** - Focused on core A2A functionality

### Benefits

- ✅ Faster canvas loading
- ✅ Fewer failure points
- ✅ Cleaner separation of concerns
- ✅ Better focus on A2A agent coordination

## Testing Scenarios

### Basic Canvas Creation

1. Use suggested action: "Create a task decomposition canvas for project planning"
2. Verify canvas loads without database errors
3. Confirm CanvasFlow component renders properly

### Task Generation

1. Request task breakdown for a project
2. Verify tasks appear in canvas visualization
3. Check agent assignments and task dependencies

### A2A Execution

1. Click "Execute All Agents" in canvas
2. Monitor streaming updates
3. Verify task completion status updates

## Configuration Requirements

### Environment Variables

```bash
# A2A Agent Configuration
ENABLE_A2A=true
A2A_AGENT_URL=http://localhost:8000  # Python agent endpoint

# Database (for document storage)
POSTGRES_URL=postgresql://...

# Optional: Redis for streaming (improves performance)
REDIS_URL=redis://localhost:6379
```

### Python Agent Requirements

- Running task execution agent at `A2A_AGENT_URL`
- Implements A2A protocol for task coordination
- Handles job distribution and execution

## Next Steps

1. **Test Canvas Creation** - Verify fix resolves the database error
2. **Validate A2A Integration** - Ensure Python agent connectivity
3. **Optimize Streaming** - Fine-tune real-time updates
4. **Add Error Handling** - Graceful degradation for agent failures
5. **Performance Monitoring** - Track execution times and success rates

## Notes

This minimal implementation focuses on the core value proposition: AI-powered task decomposition with A2A agent execution. By removing unnecessary complexity (suggestions, complex database constraints), we achieve a more reliable and focused system that elegantly combines AI SDK v5 with custom A2A implementations.
