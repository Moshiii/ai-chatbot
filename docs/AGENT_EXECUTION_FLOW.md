# Agent Execution Flow Documentation

This document provides a comprehensive overview of the complete agent execution call chain, message formats, and component interactions in the AI chatbot application.

## Overview

The agent execution system implements a sophisticated workflow where:
1. **Frontend Canvas** - User triggers execution via button click
2. **Execution API** - Handles business logic and routes to Python agent
3. **Python Agent (A2A)** - Orchestrates task execution and job processing
4. **Streaming Updates** - Real-time SSE streaming back to canvas
5. **Canvas Updates** - Visual representation updates in real-time

## Complete Call Chain

### 1. Button Click → Frontend Handler

**File**: `/artifacts/canvas/client.tsx`

```tsx
// User clicks "Execute All Agents" button in CanvasFlow component
const handleExecuteAllAgents = async () => {
  const agents = metadata?.agents || [];
  const taskId = metadata?.taskId;
  
  if (!taskId) {
    toast.error('No task ID found. Please create a task first.');
    return;
  }

  // Update UI to show in-progress status
  setMetadata((metadata) => ({
    ...metadata,
    tasks: (metadata?.tasks || []).map(task => ({
      ...task,
      status: 'in-progress' as const
    })),
  }));
  
  // Make API call
  const response = await fetch('/api/agent/execution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId,
      executionMode: 'parallel',
    }),
  });
}
```

**Message Format** (Request to API):
```json
{
  "taskId": "task_uuid_here",
  "executionMode": "parallel"
}
```

### 2. API Route Processing

**File**: `/app/api/agent/execution/route.ts`

```typescript
export async function POST(request: Request) {
  // 1. Authentication
  const session = await auth();
  
  // 2. Parse request
  const body: AgentExecutionRequest = await request.json();
  const { taskId, executionMode = 'parallel' } = body;
  
  // 3. Validate and check business logic
  const paymentRequired = await checkPaymentRequired(taskId, session.user.id);
  const rateLimitExceeded = await checkRateLimit(session.user.id);
  
  // 4. Create A2A provider for Python agent communication
  const provider = a2a(a2aAgentUrl, {
    contextId: taskId,
    toolcallSupport: true,
    taskMode: true,
    maxRetries: 2,
    timeout: 60000,
  });

  // 5. Create execution message for Python agent
  const executionMessage = {
    type: 'execute_jobs',
    taskId,
    executionMode,
    userId: session.user.id,
    timestamp: new Date().toISOString(),
  };
}
```

**Message Format** (To Python Agent):
```json
{
  "type": "execute_jobs",
  "taskId": "task_uuid_here",
  "executionMode": "parallel",
  "userId": "user_id_here",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 3. Python Agent Processing

**File**: `/python-agent/task_agent/agent_executor.py`

The Python agent receives the execution message and:
1. Looks up stored task data using `taskId`
2. Executes jobs in parallel or sequential mode
3. Uses `updateTask` tool to stream results back

**Expected Processing Flow**:
```python
# Agent receives execution message
# Looks up task by taskId
# For each job in task:
#   - Execute job with assigned agent
#   - Stream progress via updateTask tool
# Generate summary when all jobs complete
```

### 4. Streaming Response Processing

**File**: `/app/api/agent/execution/route.ts`

```typescript
// Create streaming response
const stream = createUIMessageStream<ChatMessage>({
  execute: ({ writer }) => {
    (async () => {
      // Send initial status
      writer.write({ 
        type: 'data-textDelta', 
        data: JSON.stringify({ 
          type: 'execution-started', 
          taskId, 
          message: 'Starting agent execution' 
        })
      });

      // Execute through Python agent
      const result = await provider.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(executionMessage) }] }],
      });

      // Process stream and forward events
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        if (value?.type === 'tool-call' && value.toolName === 'updateTask') {
          const toolArgs = JSON.parse(value.input || '{}');
          
          if (toolArgs.jobResponse) {
            writer.write({ 
              type: 'data-textDelta', 
              data: JSON.stringify({ 
                type: 'job-update',
                data: toolArgs.jobResponse 
              })
            });
          }
          
          if (toolArgs.summary) {
            writer.write({ 
              type: 'data-textDelta', 
              data: JSON.stringify({ 
                type: 'summary-update',
                data: toolArgs.summary 
              })
            });
          }
        }
      }
    })();
  },
});

return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
```

## Message Formats

### SSE Stream Events

#### 1. Execution Started
```json
{
  "type": "execution-started",
  "taskId": "task_uuid_here",
  "message": "Starting agent execution"
}
```

#### 2. Job Update (Legacy Format)
```json
{
  "jobResponse": {
    "jobId": "job_uuid_here",
    "agentId": "agent_uuid_here", 
    "agentName": "Agent Name",
    "status": "completed",
    "content": "Job execution result...",
    "timestamp": "2024-01-15T10:35:00.000Z"
  }
}
```

#### 3. Job Update (Standardized Format)
```json
{
  "type": "job-update",
  "data": {
    "jobId": "job_uuid_here",
    "agentId": "agent_uuid_here",
    "agentName": "Agent Name", 
    "status": "completed",
    "content": "Job execution result...",
    "timestamp": "2024-01-15T10:35:00.000Z"
  }
}
```

#### 4. Summary Update (Legacy Format)
```json
{
  "summary": {
    "id": "summary_uuid_here",
    "content": "Summary of all job results...",
    "timestamp": "2024-01-15T10:40:00.000Z"
  }
}
```

#### 5. Summary Update (Standardized Format)
```json
{
  "type": "summary-update", 
  "data": {
    "id": "summary_uuid_here",
    "content": "Summary of all job results...",
    "timestamp": "2024-01-15T10:40:00.000Z"
  }
}
```

#### 6. Execution Completed
```json
{
  "type": "execution-completed",
  "taskId": "task_uuid_here", 
  "message": "Agent execution completed"
}
```

#### 7. Execution Error
```json
{
  "type": "execution-error",
  "error": "Error message here",
  "taskId": "task_uuid_here"
}
```

### Tool Call Messages

#### updateTask Tool Call
```json
{
  "type": "tool-call",
  "toolCallId": "call_uuid_here",
  "toolName": "updateTask",
  "input": "{\"jobResponse\": {...}}"
}
```

## Canvas Processing and Updates

### 1. SSE Event Handling

**File**: `/artifacts/canvas/client.tsx`

```typescript
// Process SSE stream in handleExecuteAllAgents
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      const eventType = typeof data.type === 'string' ? data.type.replace(/^data-/, '') : '';

      // Handle different event types
      if (eventType === 'job-update' || data.type === 'job-update') {
        const jobData = data.data || data;
        setMetadata((metadata) => ({
          ...metadata,
          responses: [...(metadata?.responses || []), {
            ...jobData,
            timestamp: new Date(jobData.timestamp),
          }],
          tasks: (metadata?.tasks || []).map(job => 
            job.id === jobData.jobId
              ? { ...job, status: jobData.status || 'completed' }
              : job
          ),
        }));
      }
    }
  }
}
```

### 2. Data Stream Handler

**File**: `/components/data-stream-handler.tsx`

```typescript
export function DataStreamHandler() {
  const { dataStream } = useDataStream();
  const { artifact, setArtifact, setMetadata } = useArtifact();

  useEffect(() => {
    if (!dataStream?.length) return;

    const newDeltas = dataStream.slice(lastProcessedIndex.current + 1);
    
    newDeltas.forEach((delta) => {
      const artifactDefinition = artifactDefinitions.find(
        (def) => def.kind === artifact.kind,
      );

      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata,
        });
      }

      setArtifact((draftArtifact) => {
        switch (delta.type) {
          case 'data-id':
            return { ...draftArtifact, documentId: delta.data };
          case 'data-title': 
            return { ...draftArtifact, title: delta.data };
          case 'data-kind':
            return { ...draftArtifact, kind: delta.data };
          case 'data-finish':
            return { ...draftArtifact, status: 'idle' };
        }
      });
    });
  }, [dataStream, setArtifact, setMetadata, artifact]);
}
```

### 3. Canvas Artifact Stream Processing

**File**: `/artifacts/canvas/client.tsx`

```typescript
onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
  if (streamPart.type === 'data-textDelta') {
    setArtifact((draftArtifact) => {
      try {
        const parsedData = JSON.parse(streamPart.data);
        
        // Handle job response (both legacy and standardized formats)
        if (parsedData.jobResponse || (parsedData.type === 'job-update' && parsedData.data)) {
          const jobData = parsedData.jobResponse || parsedData.data;
          setMetadata((metadata) => ({
            ...metadata,
            responses: [...(metadata?.responses || []), {
              ...jobData,
              timestamp: new Date(jobData.timestamp),
            }],
            tasks: (metadata?.tasks || []).map(job => {
              return job.id === jobData.jobId
                ? { ...job, status: jobData.status || 'completed' }
                : job;
            }),
          }));
        }
        
        // Handle summary (both legacy and standardized formats)
        else if (parsedData.summary || (parsedData.type === 'summary-update' && parsedData.data)) {
          const summaryData = parsedData.summary || parsedData.data;
          setMetadata((metadata) => ({
            ...metadata,
            summary: {
              ...summaryData,
              timestamp: new Date(summaryData.timestamp),
            },
          }));
        }
      } catch (error) {
        // Not JSON, likely streaming text - ignore
      }
      
      return { ...draftArtifact, status: 'streaming' };
    });
  }
}
```

## Component Roles

### 1. CanvasFlow Component
**File**: `/components/canvas-flow.tsx`

**Role**: Visual representation and user interaction
- Renders ReactFlow nodes for tasks, agents, responses
- Handles "Execute All Agents" button click
- Manages transaction confirmation dialog
- Updates node positions and edge connections

**Key Data Structures**:
```typescript
interface Task {
  id: string;
  title: string; 
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'recruiting';
}

interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  taskId?: string;
  pricingUsdt?: number;
  walletAddress?: string;
}

interface Response {
  id: string;
  agentId: string;
  content: string;
  timestamp: Date;
}
```

### 2. Canvas Artifact Client
**File**: `/artifacts/canvas/client.tsx`

**Role**: Data management and API communication
- Manages metadata state (tasks, agents, responses, summary)
- Handles SSE stream processing from execution API
- Saves/loads canvas state to/from document storage
- Orchestrates execution flow and error handling

### 3. Agent Execution API
**File**: `/app/api/agent/execution/route.ts`

**Role**: Business logic and Python agent coordination
- Authentication and authorization
- Payment processing (placeholder)
- Rate limiting (placeholder) 
- A2A provider setup and streaming
- Message format transformation

### 4. A2A Chat Language Model
**File**: `/lib/ai/a2a-chat-language-model.ts`

**Role**: Python agent communication protocol
- Implements AI SDK's LanguageModelV2 interface
- Handles streaming communication with Python agents
- Processes tool calls and converts to AI SDK format
- Error handling and retry logic

### 5. Data Stream Handler
**File**: `/components/data-stream-handler.tsx`

**Role**: Stream processing coordination
- Processes AI SDK data stream events
- Routes events to appropriate artifact handlers
- Manages artifact state transitions
- Handles `data-textDelta`, `data-kind`, `data-id`, etc.

## Error Handling

### Frontend Error Handling
```typescript
try {
  // API call and stream processing
} catch (error) {
  console.error('Error executing agents:', error);
  toast.error('Failed to execute agents');
  
  // Revert job statuses on error
  setMetadata((metadata) => ({
    ...metadata,
    tasks: (metadata?.tasks || []).map(task => ({
      ...task,
      status: 'pending' as const
    })),
  }));
}
```

### API Error Responses
```typescript
// Authentication errors
if (!session?.user) {
  return new ChatSDKError('unauthorized:auth').toResponse();
}

// Validation errors  
if (!taskId) {
  return new ChatSDKError('bad_request:api', 'Task ID is required').toResponse();
}

// Service availability errors
if (!enableA2A || !a2aAgentUrl) {
  return new Response(JSON.stringify({
    error: 'Agent execution not available',
    message: 'Please set ENABLE_A2A=true and A2A_AGENT_URL in environment.',
    taskId,
  }), { status: 503 });
}
```

### Stream Error Handling
```typescript
// In streaming execute function
writer.write({ 
  type: 'data-textDelta', 
  data: JSON.stringify({ 
    type: 'execution-error', 
    error: (error as Error)?.message || 'Execution failed', 
    taskId 
  })
});
```

## Key Technologies

1. **Streaming**: Server-Sent Events (SSE) via AI SDK's `createUIMessageStream`
2. **State Management**: React useState with functional updates to prevent race conditions
3. **Communication**: A2A protocol for Python agent communication
4. **Visualization**: ReactFlow for interactive canvas representation
5. **Error Handling**: Custom `ChatSDKError` class for consistent API responses
6. **Authentication**: NextAuth.js session management

## Configuration

### Environment Variables
```bash
ENABLE_A2A=true
A2A_AGENT_URL=http://localhost:9999
```

### A2A Provider Settings
```typescript
const provider = a2a(a2aAgentUrl, {
  contextId: taskId,
  toolcallSupport: true, 
  taskMode: true,
  maxRetries: 2,
  timeout: 60000,
});
```

This documentation covers the complete agent execution flow from button click to canvas update, including all message formats, component roles, and error handling mechanisms.