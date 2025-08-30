# Refactoring Plan: A2A Task & Canvas Flow

**Version:** 1.0
**Date:** 2025-08-30

### 1. Introduction & Goal

This document provides a detailed implementation plan for refactoring the application's task generation and canvas creation workflow. The primary goal is to adopt a more robust, client-driven architecture that properly separates the concerns between the external Python agent and the Next.js client application.

The previous implementation incorrectly coupled the agent to the client's internal state by having the client pre-create a `document` and pass its ID to the agent. The new flow reverses this, empowering the agent to simply return proposed tasks, leaving all database and document management responsibilities to the Next.js backend, triggered by the frontend.

### 2. The Refined Architecture

The core of this refactoring is a client-driven, two-step flow that leverages the Vercel AI SDK's ability to stream structured data. This ensures a clean separation of concerns and a more logical sequence of events.

#### 2.1. High-Level Flow

1.  **Intent to Agent**: The user provides a prompt in the UI. The Next.js Chat API (`/api/chat`) sends this prompt to the Python agent, ensuring the `chatId` is included to be used as the `contextId`.

2.  **Agent Response**: The Python agent interprets the prompt, generates one or more task objects, and returns a single A2A `Message` object. This message is multi-part, containing:
    *   A `text` part with a human-readable confirmation message (e.g., "I have planned the following tasks.").
    *   One or more custom `data` parts, where each part contains a full task object with its initial status set to `submitted`.

3.  **Frontend Handles Response**: The Next.js frontend, using the `useChat` hook, receives the streamed message from the Chat API. The UI layer is responsible for identifying and collecting the custom `data` parts that contain the task objects.

4.  **Client-Side Trigger**: After collecting all task objects from a single agent message, the frontend makes a **new, separate API call** to a dedicated endpoint in the Next.js backend (e.g., `/api/canvas/create`).

5.  **Backend Creates Canvas & Tasks**: This new, dedicated API endpoint receives the task objects and performs all necessary database transactions in one go:
    *   It saves the tasks to the `tasks` table using the `createTask` query.
    *   It creates a new `document` of `kind: 'canvas'` using the `saveDocument` query.
    *   It links the newly created tasks to this canvas by storing their IDs in the document's `taskIds` JSONB field.
    *   It saves a new message to the chat containing a reference to the canvas artifact, making it appear in the UI.

6.  **UI Renders Canvas & Polls for Updates**: The frontend UI renders the new canvas artifact. The canvas component then begins polling a backend endpoint periodically to fetch the latest statuses of its tasks. This allows the UI to reflect near-real-time updates (e.g., `submitted` -> `working` -> `completed`) as the agent executes the tasks and sends updates via webhooks.

#### 2.2. Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant FE as Next.js Frontend
    participant ChatAPI as Next.js Chat API
    participant Agent as Python Agent
    participant CanvasAPI as Canvas Creation API
    participant DB as PostgreSQL

    User->>FE: Enters prompt to create tasks
    FE->>ChatAPI: POST /api/chat (with prompt and chatId)
    ChatAPI->>Agent: message/send (prompt, contextId=chatId)

    Agent-->>ChatAPI: Returns Message with text and data parts (tasks)
    ChatAPI-->>FE: Streams message parts to UI

    FE->>FE: Detects and collects task data parts from message
    FE->>CanvasAPI: POST /api/canvas/create (with task objects)
    
    CanvasAPI->>DB: INSERT INTO tasks (for each task)
    DB-->>CanvasAPI: Confirms task creation
    
    CanvasAPI->>DB: INSERT INTO documents (kind='canvas', taskIds=[...])
    DB-->>CanvasAPI: Returns new documentId
    
    CanvasAPI->>DB: INSERT INTO messages (with canvas reference)
    CanvasAPI-->>FE: Returns success and new canvas info

    FE->>FE: Renders Canvas Artifact in UI

    loop Polling every X seconds while canvas is open
        FE->>DB: GET /api/tasks?ids=...
        DB-->>FE: Returns latest task statuses
        FE->>FE: Re-renders canvas with new statuses
    end
```

### 3. Implementation Plan & Checklist

This plan is broken into three phases, starting with the backend, moving to the agent, and finishing with the frontend.

---

#### **Phase 1: Backend Refactoring (Next.js)**

**Goal**: Adapt the Next.js backend to support the new client-driven, two-step flow.

- [ ] **Task 1.1: Simplify the Chat API Route**
    - **File**: `app/(chat)/api/chat/route.ts`
    - **Action**: In the `POST` function, locate the `if (selectedChatModel === 'a2a-model')` block.
    - **REMOVE** the entire logic that pre-creates a `canvas` document, generates a `webhookToken`, and saves the document. This is no longer the responsibility of the chat route.
    - **MODIFY** the `a2a` provider configuration to only pass the `chatId` (as `contextId`). Remove the `documentId` and `pushNotificationConfig` from this initial call, as they are not needed for the agent's initial response.

- [ ] **Task 1.2: Create the Canvas & Task Creation API**
    - **File**: Create a new route at `app/api/canvas/create/route.ts`.
    - **Action**: Implement a `POST` handler that is well-documented and secure.
    - **Input**: The request body should be a JSON object containing `{ tasks: Task[], chatId: string }`.
    - **Authentication**: Ensure the handler checks for a valid user session.
    - **Logic**:
        1. Generate a single, secure `webhookToken` for this batch of tasks.
        2. Use `Promise.all` to call the `createTask` query from `lib/db/queries.ts` for each task object received. Ensure you save the `webhookToken` with each task.
        3. Collect the IDs of the newly created tasks.
        4. Call `saveDocument` to create a new `canvas` document. The document's `title` can be generic (e.g., "Task Plan"), and its `taskIds` field should be populated with the collected task IDs.
        5. Call `saveMessages` to insert a new message into the database for the specified `chatId`. This message should contain the reference to the new canvas artifact so it appears in the chat history.
        6. Return a `201 Created` response with the newly created canvas document object.

- [ ] **Task 1.3: Update the A2A Provider to Handle Task Data**
    - **File**: `lib/ai/a2a-chat-language-model.ts`
    - **Action**: Modify the `StreamProcessor` class inside the `createStreamFromA2A` method.
    - **Logic**: In the `processMessageParts` method, add a condition to detect if a part is a custom task object (e.g., `part.kind === 'data' && part.data.type === 'task'`). When a task part is detected, it should be transformed and enqueued as a custom UI message part that the frontend can uniquely identify, for example: `controller.enqueue({ type: 'data-task', data: part.data.task });`.

---

#### **Phase 2: Python Agent Refactoring**

**Goal**: Make the agent a pure, stateless task generator that returns tasks in a single, structured response.

- [ ] **Task 2.1: Refactor Agent's `execute` Method**
    - **File**: `python-agent/task_agent/agent_executor.py`
    - **Action**: Heavily simplify the `execute` and `_process_request_async` methods.
    - **REMOVE** all logic that looks for a `document_id` or calls webhooks during the initial task generation phase. The agent's job is now stateless in this initial step.

- [ ] **Task 2.2: Implement the New Response Format**
    - **File**: `python-agent/task_agent/agent_executor.py`
    - **Action**: The agent must return a single `Message` object via the `event_queue`.
    - **Logic**:
        1. Generate the list of job/task dictionaries based on the user's prompt.
        2. Construct a list of `Part` objects for the response.
        3. The first part should be a `TextPart` with a user-facing confirmation message.
        4. For each generated task, create a `DataPart`. The `data` payload should be a dictionary like `{ "type": "task", "task": { ...task_object... } }`. The task status must be `submitted`.
        5. Use the `event_queue` to enqueue a single agent message containing this complete list of parts.

---

#### **Phase 3: Frontend Integration**

**Goal**: Empower the UI to drive the canvas creation flow and to poll for live status updates.

- [ ] **Task 3.1: Handle Task Data in the UI**
    - **File**: The main chat component (e.g., `components/chat.tsx` or a child component).
    - **Action**: Implement a `useEffect` hook that watches the `messages` array from `useChat`.
    - **Logic**:
        1. The hook will scan the last message from the assistant.
        2. If it finds parts with `type: 'data-task'`, it will collect all task objects from that single message.
        3. To prevent the API from being called multiple times for the same message, maintain a state of processed message IDs (e.g., `const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());`).
        4. If new, unprocessed tasks are found, add the message ID to the processed set and fire a single `POST` request to the new `/api/canvas/create` endpoint.

- [ ] **Task 3.2: Implement Client-Side Polling for Status Updates**
    - **File**: The component responsible for rendering the canvas artifact (e.g., `components/artifact.tsx` or a new, dedicated canvas component).
    - **Action**: When the component mounts and displays a canvas containing `taskIds`, it should initiate polling.
    - **Logic**:
        1. Use a `useEffect` hook to set up a `setInterval` (e.g., every 5 seconds).
        2. The interval's callback will make a `GET` request to a task-fetching API endpoint (a new bulk endpoint like `/api/tasks?ids=...` would be most efficient) with the IDs of the tasks in the canvas.
        3. On receiving the latest task data, update the component's state, which will trigger a re-render of the tasks and their statuses.
        4. The `useEffect` hook's cleanup function **must** clear the interval using `clearInterval` when the component unmounts to prevent memory leaks and unnecessary API calls.
