# Feature Requirement Document: A2A Async Agent Refactoring

### 1. Introduction & Goal

This document outlines the requirements for refactoring the existing agent task management system to be fully compliant with the Agent-to-Agent (A2A) communication protocol. The goal is to **refactor the existing implementation to use a dedicated, A2A-compliant `tasks` table**, providing a more robust, scalable, and standardized architecture.

### 2. Codebase Analysis & Current Architecture

#### 2.1. High-Level Flow

A thorough review of the codebase reveals a well-established, stream-based architecture for agent communication. The agent is invoked via a `planTasks` -> `createTask` -> `updateTask` tool flow, with the frontend rendering progress and results in real-time.

#### 2.2. A2A Provider: The Bridge Component

The connection between the Vercel AI SDK and our Python agent is handled by a custom A2A provider. This provider acts as a powerful **translation layer**, allowing the AI SDK to communicate with our Python agent as if it were a standard language model, translating requests and streaming responses between the two standards.

#### 2.3. Current Limitations

The current system uses the generic `documents` table (with a `canvas` type) to store task information. This refactoring will replace that with a dedicated `tasks` table.

### 3. Proposed Refactoring & Architecture

The core of the refactoring is to replace the `documents` table as the backing store for tasks with a new `tasks` table. We will also introduce a true webhook mechanism for long-running tasks.

### 4. Database Schema Changes

_(This section is unchanged and defines the new `tasks` table and the modification to the `messages` table.)_

### 5. Developer Experience & Local Testing

_(This section is unchanged and describes the plan to enhance the Python mock agent to call a webhook upon task completion.)_

### 6. Implementation Plan & Task Checklist

Here is the detailed, incremental plan for executing the refactor. Each phase and task is designed to be implemented in order, providing a clear and traceable path to completion.

---

#### **Phase 1: Backend Foundation**

_The goal of this phase is to prepare the database and backend API to support the new task-centric architecture._

- [ ] **Task 1.1: Update Database Schema (`lib/db/schema.ts`)**
  - [ ] Add the `taskStatusEnum` export.
  - [ ] Add the `tasks` table definition as specified in Section 4.1.

- [ ] **Task 1.2: Enhance Messages Table (`lib/db/schema.ts`)**
  - [ ] Add the `data: jsonb('data')` column to the `messages` table definition.

- [ ] **Task 1.3: Apply Database Migration**
  - [ ] Run `pnpm db:generate` to create the migration file.
  - [ ] Review the generated SQL in the new migration file for correctness.
  - [ ] Run `pnpm db:migrate` to apply the changes to the database.

- [ ] **Task 1.4: Create Webhook API Route**
  - [ ] Create a new file: `app/api/webhook/tasks/route.ts`.
  - [ ] Implement a `POST` handler that receives a task update (e.g., `{ taskId, status, result }`).
  - [ ] The handler must validate a secret token from the `Authorization: Bearer <token>` header.
  - [ ] On successful validation, it should update the corresponding record in the `tasks` table.

---

#### **Phase 2: Refactor Core Tools**

_The goal of this phase is to modify the existing AI tools to use the new `tasks` table instead of the `documents` table._

- [ ] **Task 2.1: Refactor `createTask` Tool (`lib/ai/tools/create-task.ts`)**
  - [ ] Remove the logic that creates a `document` of kind `canvas`.
  - [ ] Import and use the `generateTaskIds` function from `lib/id-management.ts` to create a new task ID.
  - [ ] Implement a call to `db.insert(tasks).values(...)` to create a new record in the `tasks` table with the initial data.
  - [ ] When streaming data back to the client, ensure the `data` property of the message is populated with `{ artifactType: 'task', taskId: '...' }`.

- [ ] **Task 2.2: Refactor `updateTask` Tool (`lib/ai/tools/update-task.ts`)**
  - [ ] Modify the `execute` function to receive task/job updates.
  - [ ] Implement a call to `db.update(tasks).set({ ... }).where(eq(tasks.id, ...))` to update the status and results of the task in the database.

---

#### **Phase 3: Refactor Frontend & API**

_The goal of this phase is to adapt the frontend components to display data from the new `tasks` table._

- [ ] **Task 3.1: Create Task-Fetching API Route**
  - [ ] Create a new file: `app/api/tasks/[id]/route.ts`.
  - [ ] Implement a `GET` handler that takes a task ID from the URL.
  - [ ] The handler should query the `tasks` table and return the corresponding task object.

- [ ] **Task 3.2: Refactor Canvas Artifact (`components/artifact.tsx`)**
  - [ ] Locate the `useSWR` hook that currently fetches `/api/document`.
  - [ ] Add a condition: if `artifact.kind === 'canvas'` (or a new kind like `'task'`), it should instead call the new `/api/tasks/[id]` endpoint.
  - [ ] Ensure the component correctly handles the new A2A Task object structure.

- [ ] **Task 3.3: Update Message Component (`components/message.tsx`)**
  - [ ] In the component that renders message parts, add a condition to check for `part.type === 'tool-createTask'` or `message.data.artifactType === 'task'`.
  - [ ] When this condition is met, render a specific preview component for the task artifact, which should link to or open the main `Artifact` view.

---

#### **Phase 4: Agent Alignment & Final Testing**

_The goal of this phase is to align the mock agent with the new flow and perform end-to-end testing._

- [ ] **Task 4.1: Enhance Python Mock Agent (`python-agent/task_agent/agent_executor.py`)**
  - [ ] Implement the `_call_webhook` method as described in Section 5.2.
  - [ ] Modify the `_execute_jobs` method to call `_call_webhook` with the final results after the job simulation loop is complete.

- [ ] **Task 4.2: Write End-to-End Tests**
  - [ ] Using Playwright, create a new test file for the A2A flow.
  - [ ] The test should simulate the full user journey:
    1. Sending a prompt that triggers task planning.
    2. Verifying that the task artifact appears in the chat.
    3. Opening the artifact and triggering execution.
    4. Verifying that the UI updates based on the streamed data from the mock agent.
    5. Verifying that the final webhook call is received by the backend (this may require mocking the webhook endpoint in the test environment).

---

### 7. AI SDK v5 + A2A Integration Details

This section specifies the precise integration between AI SDK v5 and the A2A protocol using our custom provider. The objective is to send messages to a remote A2A orchestrator agent, receive an immediate acknowledgement (ACK) without holding a long-lived HTTP connection, and then receive a webhook notification upon task completion.

#### 7.1. Provider Strategy

- **Custom Provider**: We expose A2A endpoints as a LanguageModelV2 via a custom provider wrapper so the rest of the app can select an "a2a" model like any other model.
- **Model Mapping**: Use a stable alias for the A2A agent URL. In code, `model: a2a(AGENT_URL, settings)` should be selectable via our model selector.
- **Default Settings**:
  - `blocking: false` for non-streaming immediate ACK requests
  - `acceptedOutputModes: ['text/plain', 'application/json']`
  - `pushNotificationConfig: { url, token }` provided on requests to support async webhook notifications

Example custom provider concept (reference): see AI SDK v5 `customProvider` docs [link](https://v5.ai-sdk.dev/docs/reference/ai-sdk-core/custom-provider).

#### 7.2. Messages and Streaming (AI SDK v5)

- AI SDK v5 introduces `UIMessage` and `ModelMessage` types. Always store and handle messages in `UIMessage` form and convert to `ModelMessage` only for model calls. See [Message Overhaul](https://v5.ai-sdk.dev/docs/announcing-ai-sdk-5-beta).
- For chat endpoints, prefer SSE to stream UI parts. However, for A2A we will avoid long-running streams for task execution. We only accept the initial response (ACK) and then rely on webhooks.

#### 7.3. Orchestrator Flow (ACK + Webhook)

1. Client sends `message/send` (non-streaming) with `configuration.blocking = false` and `configuration.pushNotificationConfig` containing the absolute HTTPS webhook `url` and a client-generated `token`.
2. Remote A2A agent immediately returns a JSON-RPC success response with a `Task` object whose `status.state ∈ {submitted, working}`.
3. Backend stores the task in our `tasks` table and surfaces it to the UI.
4. The A2A agent executes jobs asynchronously and, upon completion (or failure), POSTs to our webhook with the final status, artifacts, and any result data.

References:

- A2A ACK and example response [link](https://a2aprotocol.ai/docs/guide/a2a-sample-methods-and-json-responses.html).
- A2A push notifications (webhook) [link](https://a2a-protocol.org/dev/topics/streaming-and-async/).

---

### 8. A2A Request/Response Contracts

#### 8.1. Initial Request (Client → A2A Orchestrator)

- Transport: JSON-RPC 2.0 over HTTPS
- Method: `message/send`
- Params shape (subset):

```json
{
  "message": {
    "kind": "message",
    "messageId": "<uuid>",
    "role": "user",
    "parts": [{ "kind": "text", "text": "<user instruction>" }],
    "contextId": "<uuid>"
  },
  "configuration": {
    "blocking": false,
    "acceptedOutputModes": ["text/plain", "application/json"],
    "pushNotificationConfig": {
      "url": "https://<host>/api/webhook/tasks",
      "token": "<opaque-client-generated-token>"
    }
  }
}
```

Notes:

- `blocking: false` enforces immediate ACK behavior.
- The `token` will be echoed by the server to our webhook caller via `Authorization: Bearer <token>` or in a provider-defined header to allow validation.

#### 8.2. Immediate ACK (A2A → Client)

Expected success response (subset):

```json
{
  "jsonrpc": "2.0",
  "id": "<same-as-request-id>",
  "result": {
    "id": "<task-id>",
    "contextId": "<context-id>",
    "kind": "task",
    "status": {
      "state": "submitted",
      "timestamp": "2024-03-15T11:00:00Z"
    }
  }
}
```

Behavior:

- Treat `state ∈ {submitted, working}` as ACK; write/update the `tasks` row accordingly and render in the UI.

#### 8.3. Webhook Notification (A2A → Backend)

- Method: `POST`
- URL: `/api/webhook/tasks`
- Headers: `Authorization: Bearer <token>` (must match the client-provided token for this task)
- Body (subset):

```json
{
  "id": "<task-id>",
  "contextId": "<context-id>",
  "kind": "task",
  "status": { "state": "completed", "timestamp": "2024-03-15T18:30:00Z" },
  "artifacts": [
    {
      "artifactId": "<artifact-uuid>",
      "parts": [{ "kind": "data", "data": { "result": "..." } }]
    }
  ]
}
```

Behavior:

- Validate token, upsert `tasks` status and results, and notify the UI via SWR/cache invalidation or server-push (SSE or revalidation).
- Handle terminal states: `completed`, `failed`, `canceled`, `rejected`.

---

### 9. Database Mapping and Status Lifecycle

#### 9.1. Status Mapping

- A2A `TaskStatus.state` is mapped to our `taskStatusEnum` with values: `submitted | working | input-required | completed | canceled | failed | rejected | auth-required | unknown` (see `docs/A2A_specification.json`).
- Required transitions we support: `submitted → working → (completed | failed | canceled)`.

#### 9.2. Required Columns (recap)

- `id: text` (task id, from A2A Task.id)
- `contextId: text`
- `status: taskStatusEnum`
- `statusMessage: text | null` (from `status.message.parts[text]` if provided)
- `result: jsonb | null` (final artifact or structured result)
- `webhookToken: text` (per-task opaque token we created for validation)
- `createdAt: timestamp with time zone`
- `updatedAt: timestamp with time zone`

Indexes:

- `PRIMARY KEY(id)`
- `INDEX contextId`
- `INDEX status`

RLS (if enabled):

- Ensure a user can only read tasks belonging to their session/tenant.

---

### 10. Backend/API Requirements

#### 10.1. Webhook Route: `app/api/webhook/tasks/route.ts`

- Method: `POST`
- AuthN: Require `Authorization: Bearer <token>`
- Steps:
  - Parse JSON body, validate shape against A2A `Task` subset (id, contextId, status, artifacts?)
  - Verify token matches a stored `webhookToken` for the task
  - Idempotent upsert: update `status`, `statusMessage`, `result`, `updatedAt`
  - Return `204 No Content`
  - On invalid token: `401 Unauthorized`
  - On validation error: `400 Bad Request`

#### 10.2. Task Fetch Route: `app/api/tasks/[id]/route.ts`

- Method: `GET`
- AuthZ: Ensure the task belongs to the requesting user/session
- Returns: The `tasks` row as JSON for UI consumption

#### 10.3. Chat Route Behavior (Server)

- When `model` is `a2a(...)`, ensure we call the A2A client with:
  - `message/send` (non-streaming)
  - `configuration.blocking = false`
  - `configuration.pushNotificationConfig = { url, token }`
- Persist the ACK as a `tasks` row and emit a UI message part with `data: { artifactType: 'task', taskId }` so the frontend can render a Task artifact immediately.

---

### 11. Frontend/UI Requirements

- `components/artifact.tsx` (Canvas):
  - If `artifact.kind === 'task'` (or use new kind), fetch from `/api/tasks/[id]`
  - Show current status badge; read-only details until execution completes
  - Provide an "Execute" or "Start" control if applicable to trigger downstream remote execution (depends on orchestrator design)

- `components/message.tsx`:
  - If `message.data.artifactType === 'task'`, render a compact task preview linking to the full artifact view

- Revalidation:
  - On webhook, invalidate task caches (SWR mutate or route revalidation) so the UI updates without reload

---

### 12. Provider/Client Changes (Code Alignment)

- `lib/ai/a2a-chat-language-model.ts`:
  - For ACK-only flow, the `sendMessage` call must use `configuration.blocking = false` and include `pushNotificationConfig`
  - Avoid streaming for long tasks; `doStream` may be used only for short, planning-oriented interactions if needed. Default path for orchestration is non-streaming ACK + webhook
  - Persist ACK result to DB (via caller) and return a UI-compatible content part indicating task created

- `lib/ai/a2a-provider.ts`:
  - Support settings for `pushNotificationUrl` and inject per-call token
  - Expose `taskMode: true` to ensure the model uses the ACK + webhook path

---

### 13. Security

- Webhook tokens are per-task, random, and stored in `tasks.webhookToken`
- Validate `Authorization: Bearer <token>` on webhook, reject mismatches
- Ensure webhook `url` is HTTPS and publicly reachable
- Optionally log and rate-limit webhook calls
- Do not include PII in artifacts unless strictly necessary

---

### 14. Observability & Failure Modes

- Log initial ACK (task created) and webhook completion (task terminal state)
- Retry policy for transient DB or network failures (A2A client already retries; document limits)
- If webhook not received within SLA (e.g., 30 minutes), surface `unknown` or `failed` with a timeout reason and allow manual retry/cancel

---

### 15. Test Plan (Expanded)

- Unit tests for webhook handler (authz, idempotency, happy path, invalid token)
- Integration test for chat route creating a task (ACK stored, UI message part contains `{ artifactType: 'task', taskId }`)
- E2E (Playwright):
  - Trigger a prompt that plans tasks
  - Verify task artifact appears
  - Simulate agent completion by POSTing webhook payload; verify UI updates and task state transitions to `completed`

---

### 16. Environment & Configuration

- `A2A_AGENT_URL` (remote orchestrator endpoint)
- `A2A_WEBHOOK_URL` (public HTTPS URL to `/api/webhook/tasks`)
- `A2A_WEBHOOK_TOKEN_TTL` (optional, seconds; if rotating tokens)
- `NEXT_PUBLIC_A2A_ENABLED` (feature flag)

---

### 17. Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Next.js UI
  participant API as Chat API
  participant A2A as A2A Orchestrator
  participant DB as Postgres (tasks)
  participant WH as Webhook (/api/webhook/tasks)

  User->>UI: Prompt to generate plan/execute tasks
  UI->>API: POST /api/chat (UIMessage → ModelMessage)
  API->>A2A: JSON-RPC message/send (blocking=false, pushNotificationConfig)
  A2A-->>API: ACK Task {state: submitted|working}
  API->>DB: upsert tasks (status=submitted/working)
  API-->>UI: UI message with data {artifactType: 'task', taskId}
  UI->>DB: fetch /api/tasks/[id] for canvas view

  A2A->>WH: POST completion webhook (Authorization: Bearer <token>)
  WH->>DB: update task (status=completed|failed|canceled, result)
  WH-->>UI: trigger revalidation/SWR mutate
  UI->>DB: refetch task; render final result in canvas
```

---

### 18. Implementation Notes & References

- AI SDK v5 custom provider and transport: [docs](https://v5.ai-sdk.dev/docs/announcing-ai-sdk-5-beta)
- `customProvider` reference: [docs](https://v5.ai-sdk.dev/docs/reference/ai-sdk-core/custom-provider)
- A2A immediate ACK sample: [docs](https://a2aprotocol.ai/docs/guide/a2a-sample-methods-and-json-responses.html)
- A2A push notifications (async updates): [docs](https://a2a-protocol.org/dev/topics/streaming-and-async/)

Non-goals:

- Long-lived HTTP streams for task execution results. We explicitly avoid keeping the client connection open for long-running tasks.

---

### 19. Message & Context Mapping (AI SDK 5)

Goal: Use AI SDK v5-native message structures, while cleanly mapping A2A Task context.

- **Message Types**: Persist conversation in `UIMessage[]` form and convert to `ModelMessage[]` at request time using `convertToModelMessages` [link](https://v5.ai-sdk.dev/docs/announcing-ai-sdk-5-beta).
- **Parts**: Prefer `text`, `file`, and `data` parts for structured payloads. Tool progress/status events from A2A can be rendered as `data` parts in messages when needed.
- **Context Mapping**:
  - `chatId → contextId`: For any chat session, generate or reuse a stable `contextId` that is sent with A2A `Message.contextId`. Store mapping in DB (e.g., `chats.contextId`).
  - A2A `Task.contextId` must match the `Message.contextId` so that tasks can be related back to the chat history.
- **Referencing Tasks in Messages**:
  - When a task is ACKed, append a UI message with a `data` part: `{ artifactType: 'task', taskId: '<id>' }`.
  - Downstream UI components use this reference to fetch `/api/tasks/[id]`.
- **Rationale**: This keeps the chat history canonical as `UIMessage[]` (AI SDK standard) while using `tasks` as the system of record for orchestration state.

---

### 20. Data Model Linking: Messages ↔ Tasks

- **Separate Concerns**: Keep `tasks` in a dedicated table aligned with A2A `Task`. Keep chat history in `messages` aligned with AI SDK `UIMessage`.
- **Links**:
- `messages.data.taskId` optional field for messages that introduce or update a task.
- `tasks.contextId` equals the chat session context id.
- Optional `messages.contextId` column mirrors the chat context id for faster joins.
- **Queries**:
  - Fetch tasks by `contextId` to show task list in a chat.
  - Fetch a single task by `id` for canvas rendering.

---

### 21. Codebase Integration Touchpoints (Evaluation)

- `app/(chat)/api/chat/route.ts`:
  - Ensure we convert `UIMessage[]` → `ModelMessage[]` before calling the model [link](https://v5.ai-sdk.dev/docs/announcing-ai-sdk-5-beta).
  - When `a2a(...)` model selected and `taskMode` enabled: send `message/send` with `blocking=false` and `pushNotificationConfig`.
  - On ACK: persist `tasks` row and append a UI message with `{ artifactType: 'task', taskId }`.

- `lib/ai/a2a-chat-language-model.ts`:
  - Inject `pushNotificationConfig` (env-provided URL and per-request token) in non-stream path.
  - Default to ACK + webhook flow for orchestrated tasks.

- `components/artifact.tsx` (Canvas) and related components:
  - If `artifactType==='task'`, fetch `/api/tasks/[id]`. Render status, metadata, and artifacts; update on webhook-triggered revalidation.

- DB & Queries (`lib/db/schema.ts`, `lib/db/queries.ts`):
  - Ensure `tasks` schema supports A2A states and result JSON, plus `webhookToken`.
  - Provide helpers to upsert ACK and finalize on webhook.

---

### 22. Python Orchestrator Mock: Upgrade Plan (Local Flow)

We will implement a minimal JSON-RPC A2A-compatible orchestrator inside `python-agent/` to support the ACK + webhook contract.

#### 22.1. Endpoints

- `POST /jsonrpc` single endpoint handling:
  - `message/send`: return immediate `Task` ACK with `status.state='submitted'| 'working'`.
  - Optionally accept `tasks/get` for local inspection.

#### 22.2. Behavior

- On `message/send` with `blocking=false` and `pushNotificationConfig`:
  - Generate `task.id` and `contextId` from request.
  - Return ACK immediately.
  - Spawn async worker (thread/asyncio) to simulate execution and then POST final `Task` to client webhook with `Authorization: Bearer <token>`.

#### 22.3. Implementation Tasks (Python)

- [ ] Add simple JSON-RPC server to `python-agent/task_agent/agent_executor.py`.
- [ ] Parse `message/send`, read `configuration.pushNotificationConfig`.
- [ ] Return immediate `Task` ACK with `submitted` or `working` state.
- [ ] Simulate long-running work; accumulate a simple `artifact.parts=[{kind:'data', data:{result: '...'}}]`.
- [ ] Implement `_call_webhook(url, token, task)` using `requests` (or `httpx`).
- [ ] POST final `Task` with terminal state to webhook.
- [ ] Provide `make run` or `python -m task_agent` entry for local startup.

References for orchestrator/worker patterns: [AI SDK Agents](https://v5.ai-sdk.dev/docs/foundations/agents).

---

### 23. Additional Tasks (Back-End & Front-End)

- Backend
  - [ ] Add `contextId` support for chats; persist mapping `chatId ↔ contextId`.
  - [ ] Implement `app/api/webhook/tasks/route.ts` with token validation and idempotent updates.
  - [ ] Implement `app/api/tasks/[id]/route.ts` to fetch tasks.
  - [ ] Generate and store per-task `webhookToken`.

- Frontend
  - [ ] Update message composer/handlers to include `{ artifactType: 'task', taskId }` data part on ACK.
  - [ ] Update canvas to read from `/api/tasks/[id]` and show lifecycle.
  - [ ] SWR mutate or revalidation on webhook.

---

### 24. ISEK (External Agent Framework) Notes

The ISEK framework provides decentralized agent orchestration and P2P discovery. For our local mock we only need a minimal orchestrator, but later we can explore adapting ISEK nodes as remote workers/orchestrators. Key fit points based on repository overview:

- ISEK agents can integrate various LLM backends and expose protocol layers for inter-agent communication, aligning with our A2A approach [repo](https://github.com/isekOS/ISEK).
- For now, we’ll keep our Python mock lightweight and A2A-focused. Future work could wrap an ISEK agent to implement the same JSON-RPC `message/send` semantics and webhook callbacks.
