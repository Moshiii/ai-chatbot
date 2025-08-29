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

*(This section is unchanged and defines the new `tasks` table and the modification to the `messages` table.)*

### 5. Developer Experience & Local Testing

*(This section is unchanged and describes the plan to enhance the Python mock agent to call a webhook upon task completion.)*

### 6. Implementation Plan & Task Checklist

Here is the detailed, incremental plan for executing the refactor. Each phase and task is designed to be implemented in order, providing a clear and traceable path to completion.

--- 

#### **Phase 1: Backend Foundation**
*The goal of this phase is to prepare the database and backend API to support the new task-centric architecture.*

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
*The goal of this phase is to modify the existing AI tools to use the new `tasks` table instead of the `documents` table.*

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
*The goal of this phase is to adapt the frontend components to display data from the new `tasks` table.*

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
*The goal of this phase is to align the mock agent with the new flow and perform end-to-end testing.*

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