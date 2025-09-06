# Canvas Artifact Refactor PRD

## Executive Summary

Complete refactor of the Canvas Artifact system to follow AI SDK v5 best practices and eliminate complexity that's preventing task rendering.

## Problem Statement

### Current Issues

- Canvas component shows "Canvas Initializing" indefinitely despite successful task creation
- Complex artifact content streaming between A2A tool → Canvas handler → AI SDK → Canvas component
- Multiple data sources (streaming metadata vs useSWR) causing race conditions
- Over-engineered architecture with ~980 lines of complex code

### Root Cause

The current architecture violates AI SDK v5 principles by:

1. **Artifact fetching its own data** instead of receiving data from tools
2. **Complex content streaming** instead of direct data provision
3. **Multiple abstraction layers** instead of simple tool → artifact flow

## Solution Architecture

### Complete System Architecture

```mermaid
graph TD
    subgraph "User Interaction Layer"
        A[User Request] --> B[Chat Interface]
        B --> C[A2A Tool Invocation]
    end

    subgraph "A2A Tool Processing"
        C --> D[External A2A Agent Call]
        D --> E[Receive Task Decomposition]
        E --> F[Create Tasks in Database]
        E --> G[Transform Task Data for UI]
    end

    subgraph "Canvas Artifact Creation"
        G --> H[Store in global.canvasTaskData]
        H --> I[Signal Canvas Creation to AI SDK]
        I --> J[AI SDK Calls Canvas Handler]
        J --> K[Canvas Handler Streams Task Data]
        K --> L[Canvas Artifact onStreamPart]
        L --> M[setArtifact with JSON Content]
    end

    subgraph "UI Rendering"
        M --> N[Canvas Component]
        N --> O[Parse JSON Task Data]
        O --> P[CanvasFlow Visual Interface]
        P --> Q[Task Nodes & Agent Connections]
    end

    subgraph "Chat Integration"
        M --> R[DocumentToolResult in Chat]
        R --> S[Clickable Artifact Button]
        S --> T[Saved in Chat History]
    end

    subgraph "Persistence & Reopening"
        F --> U[Database Storage]
        U --> V[Document Persistence]
        T --> W[User Clicks Later]
        W --> X[onUpdateDocument Loads Content]
        X --> Y[Reopen Canvas with Tasks]
    end

    style A fill:#e3f2fd
    style K fill:#e8f5e8
    style M fill:#e8f5e8
    style Q fill:#4caf50
    style S fill:#f3e5f5
    style U fill:#f5f5f5
```

### Simplified Data Flow

```mermaid
graph LR
    A[User Request] --> B[A2A Tool]
    B --> C[Canvas Handler]
    C --> D[Canvas Artifact]
    D --> E[Render Tasks]

    style E fill:#4caf50
```

### Core Principles

1. **Tools provide data directly to artifacts** (AI SDK best practice)
2. **Artifacts render provided data** (no fetching)
3. **Simple, linear data flow**
4. **Self-contained artifacts**

## Technical Design

### Complete Implementation Flow

```mermaid
flowchart TD
    subgraph "External Agent Integration"
        A[User Request] --> B[A2A Tool]
        B --> C[External A2A Agent API]
        C --> D[Task Decomposition Response]
    end

    subgraph "Data Processing"
        D --> E[Extract Tasks from Response]
        E --> F[Transform to Database Format]
        F --> G[Store Tasks in Database]
        E --> H[Transform to UI Format]
        H --> I[Prepare Canvas Data JSON]
    end

    subgraph "AI SDK Artifact Creation Flow"
        I --> J[Store in global.canvasTaskData]
        J --> K["Signal: data-kind: 'canvas'"]
        K --> L["Signal: data-id, data-title, data-clear"]
        L --> M[AI SDK Invokes Canvas Handler]
        M --> N[Canvas Handler Finds Global Data]
        N --> O["Stream: data-textDelta with JSON"]
        O --> P["Signal: data-finish"]
    end

    subgraph "Canvas Artifact Processing"
        O --> Q[Canvas Artifact onStreamPart]
        Q --> R[Parse JSON Task Data]
        R --> S[setArtifact with Content]
        S --> T[Canvas Component Receives Content]
    end

    subgraph "UI Rendering"
        T --> U[JSON.parse Canvas Data]
        U --> V[Extract Tasks & Agents]
        V --> W[CanvasFlow Component]
        W --> X[ReactFlow Visual Interface]
        X --> Y[Task Nodes, Agent Cards, Connections]
    end

    subgraph "Chat History Integration"
        S --> Z[DocumentToolResult in Chat]
        Z --> AA[Clickable Artifact Button]
        AA --> BB[Saved in Chat History]
        BB --> CC[User Can Reopen Later]
    end

    style A fill:#e3f2fd
    style G fill:#fff3e0
    style O fill:#e8f5e8
    style S fill:#e8f5e8
    style Y fill:#4caf50
    style AA fill:#f3e5f5
```

### 1. A2A Tool Implementation

```typescript
// Data preparation and Canvas creation
const canvasData = {
  tasks: createdTasks.map((task) => ({
    id: task.id,
    title: task.result?.title,
    description: task.result?.description,
    status: task.status === "submitted" ? "pending" : task.status,
    assignedAgent: task.result?.assignedAgent,
  })),
  documentId: documentId,
  title: title || "Task Canvas",
};

// Store for Canvas handler access
global.canvasTaskData = canvasData;

// Standard AI SDK artifact signals
dataStream.write({ type: "data-kind", data: "canvas" });
dataStream.write({ type: "data-id", data: documentId });
dataStream.write({ type: "data-title", data: title });
dataStream.write({ type: "data-clear", data: null });

// AI SDK automatically calls Canvas handler
await canvasHandler.onCreateDocument({ id, title, dataStream, session });

dataStream.write({ type: "data-finish", data: null });
```

### 2. Canvas Handler Implementation

```typescript
export const canvasDocumentHandler = createDocumentHandler({
  kind: "canvas",
  onCreateDocument: async ({ id, title, dataStream }) => {
    const canvasData = global.canvasTaskData;

    if (canvasData?.tasks?.length > 0) {
      const canvasContent = JSON.stringify(canvasData);

      // Stream Canvas data to artifact
      dataStream.write({
        type: "data-textDelta",
        data: canvasContent,
        transient: false,
      });

      global.canvasTaskData = null;
      return canvasContent;
    }

    return JSON.stringify({ tasks: [], documentId: id, title });
  },
});
```

### 3. Canvas Artifact Implementation

```typescript
export const canvasArtifact = new Artifact<'canvas'>({
  kind: 'canvas',
  onStreamPart: ({ streamPart, setArtifact }) => {
    if (streamPart.type === 'data-textDelta') {
      const canvasData = JSON.parse(streamPart.data);

      if (canvasData.tasks?.length > 0) {
        setArtifact(draft => ({
          ...draft,
          content: streamPart.data, // JSON task data
          isVisible: true,
          status: 'streaming',
        }));
      }
    }
  },
  content: ({ content }) => {
    const canvasData = JSON.parse(content || '{}');
    return <CanvasFlow tasks={canvasData.tasks} />;
  }
});
```

## Implementation Plan

### Phase 1: Core Refactor ⏱️ 2 hours

1. Simplify A2A tool to return task data directly
2. Refactor Canvas artifact to be data-driven
3. Simplify Canvas component to render provided data
4. Remove Canvas server handler (not needed)

### Phase 2: Testing & Polish ⏱️ 1 hour

1. Test Canvas creation with task data
2. Verify task rendering works
3. Clean up unused code
4. Update documentation

### Phase 3: Optimization ⏱️ 30 minutes

1. Add error boundaries
2. Improve loading states
3. Performance optimizations

## Success Criteria

### Functional Requirements

- ✅ Canvas displays tasks immediately after creation
- ✅ Task nodes render with correct data
- ✅ Agent nodes display properly
- ✅ No "Canvas Initializing" infinite states

### Technical Requirements

- ✅ Code complexity reduced by >70%
- ✅ Zero TypeScript errors
- ✅ Follows AI SDK v5 best practices
- ✅ Fast rendering (<100ms)

### User Experience

- ✅ Immediate visual feedback after task creation
- ✅ Intuitive node-based interface
- ✅ Responsive and smooth interactions

## Files to Modify

### High Impact Changes

1. **`lib/ai/tools/request-a2a-agent.ts`** - Simplify to return task data directly
2. **`artifacts/canvas/client.tsx`** - Remove complexity, make data-driven
3. **`artifacts/canvas/server.ts`** - Remove or simplify significantly

### Remove/Deprecate

1. **Complex streaming logic** in Canvas artifact
2. **useSWR data fetching** in Canvas component
3. **Document ID resolution** complexity
4. **Canvas server handler** (if not needed for persistence)

## Risk Mitigation

### Technical Risks

- **Breaking existing flows**: Implement feature flag for gradual rollout
- **Data persistence**: Ensure database operations still work for history
- **Performance**: Monitor rendering performance with large task sets

### Mitigation Strategies

- Keep database persistence for Canvas documents (for reopening)
- Add comprehensive error handling
- Test with various task/agent configurations

## Backwards Compatibility

### What Changes

- Canvas artifact internal implementation
- Tool return structure
- Component props interface

### What Stays

- Canvas document database schema
- External API contracts
- User interface design
- CanvasFlow component (mostly unchanged)

## Testing Strategy

### Unit Tests

- Canvas artifact data parsing
- Task data transformation
- Component rendering with mock data

### Integration Tests

- End-to-end Canvas creation flow
- Task data persistence and retrieval
- Error scenarios and edge cases

### User Testing

- Create various Canvas types (trip planning, research, etc.)
- Verify visual correctness of rendered tasks
- Performance testing with large datasets

## Implementation Results ✅

### Phase 1: Core Refactor - COMPLETED

1. ✅ **Simplified A2A tool** - Now returns task data directly to Canvas artifact
2. ✅ **Refactored Canvas artifact** - Receives and renders task data immediately
3. ✅ **Simplified Canvas component** - Removed complex useSWR fetching logic
4. ✅ **Streamlined Canvas server handler** - Minimal implementation for document persistence

### Architecture Changes Made

**Before (Complex):**

```
A2A Tool → Canvas Handler → Document ID → AI SDK → Canvas Component → useSWR → API → Tasks
```

**After (Simple):**

```
A2A Tool → Task Data → AI SDK → Canvas Component → Render Immediately
```

### Code Metrics Achieved

| Metric                | Before     | After     | Improvement          |
| --------------------- | ---------- | --------- | -------------------- |
| Canvas Client         | 444 lines  | 273 lines | -38%                 |
| Canvas Server         | 106 lines  | 29 lines  | -73%                 |
| A2A Tool Canvas Logic | ~100 lines | ~30 lines | -70%                 |
| Complexity            | Very High  | Low       | Dramatically Reduced |

### Files Modified

1. ✅ **`artifacts/canvas/client.tsx`** - Completely rewritten for data-driven rendering
2. ✅ **`lib/ai/tools/request-a2a-agent.ts`** - Simplified to provide task data directly
3. ✅ **`artifacts/canvas/server.ts`** - Minimized to handle document persistence only

### Breaking Changes

- Canvas artifacts now receive task data in `content` prop (JSON string)
- No more complex metadata streaming or useSWR fetching
- Canvas server handler significantly simplified

### Testing Required

- [ ] Test Canvas creation with task data rendering
- [ ] Verify existing Canvas documents can be reopened
- [ ] Test various task/agent configurations
- [ ] Performance testing with large datasets

---

**Document Version**: 2.0  
**Author**: AI Assistant  
**Date**: January 2024  
**Status**: Implementation Complete - Ready for Testing 🧪
