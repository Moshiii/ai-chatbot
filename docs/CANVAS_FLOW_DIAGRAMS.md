# Canvas System - Complete Flow Diagrams

## Master Architecture Overview

### Complete System Architecture

```mermaid
graph TB
    subgraph "🌐 External Services"
        EXT[External A2A Agent API]
        EXT2[Task Decomposition Service]
    end

    subgraph "🛠️ Application Backend"
        A2A[A2A Tool requestA2AAgent]
        HANDLER[Canvas Server Handler]
        DB[(Database)]
        GLOBAL[Global Canvas Data Store]
    end

    subgraph "🎨 AI SDK v5 Layer"
        SDK[AI SDK Streaming Pipeline]
        ARTIFACTS[Artifact System]
        TOOLS[Tool Call Management]
    end

    subgraph "🖥️ Frontend Components"
        CANVAS_ART[Canvas Artifact Client]
        CANVAS_COMP[Canvas Component]
        CANVASFLOW[CanvasFlow Visualization]
        MESSAGE[Message Component]
    end

    subgraph "👤 User Interface"
        CHAT[Chat Interface]
        SIDEPANEL[Canvas Side Panel]
        HISTORY[Chat History Buttons]
    end

    CHAT --> A2A
    A2A <--> EXT
    EXT <--> EXT2
    A2A --> DB
    A2A --> GLOBAL
    A2A --> SDK
    SDK --> ARTIFACTS
    ARTIFACTS --> HANDLER
    HANDLER --> GLOBAL
    HANDLER --> SDK
    SDK --> CANVAS_ART
    CANVAS_ART --> CANVAS_COMP
    CANVAS_COMP --> CANVASFLOW
    CANVASFLOW --> SIDEPANEL
    CANVAS_ART --> MESSAGE
    MESSAGE --> HISTORY
    DB --> HANDLER

    style CHAT fill:#e3f2fd
    style A2A fill:#fff3e0
    style HANDLER fill:#e8f5e8
    style CANVAS_ART fill:#e8f5e8
    style CANVASFLOW fill:#4caf50
    style HISTORY fill:#f3e5f5
```

## Core Flow Diagrams

### 1. Canvas Creation Flow (Primary Use Case)

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant Chat as 💬 Chat Interface
    participant A2A as 🤖 A2A Tool
    participant API as 🌐 External A2A API
    participant DB as 💾 Database
    participant Handler as 🛠️ Canvas Handler
    participant Artifact as 🎨 Canvas Artifact
    participant Canvas as 🖼️ Canvas Component
    participant Flow as 📊 CanvasFlow

    User->>Chat: "Plan a 5-day trip to Japan"
    Chat->>A2A: requestA2AAgent({userRequirements, title})

    Note over Chat: Shows "🟣 A2A Agent Planning..."

    A2A->>API: POST /create-tasks
    API-->>A2A: Task decomposition response

    loop For each task
        A2A->>DB: Store task in database
    end

    A2A->>A2A: Transform tasks for Canvas UI
    A2A->>Handler: Store in global.canvasTaskData

    Note over A2A,Handler: AI SDK Artifact Creation Flow
    A2A->>Handler: data-kind: 'canvas'
    A2A->>Handler: data-id, data-title, data-clear
    Handler->>Handler: onCreateDocument() called
    Handler->>Handler: Find global.canvasTaskData
    Handler->>Artifact: data-textDelta (task JSON)
    A2A->>Handler: data-finish

    Artifact->>Artifact: onStreamPart receives JSON
    Artifact->>Artifact: setArtifact(content: JSON)
    Artifact->>Canvas: Pass content prop
    Canvas->>Canvas: JSON.parse(content)
    Canvas->>Flow: Pass tasks & agents
    Flow->>User: ✅ Display visual task interface

    Note over Chat: Shows "✅ Created 'Japan Trip Planning'" button
```

### 2. Chat History Integration Flow

```mermaid
graph TD
    subgraph "Canvas Creation"
        A[A2A Tool Completes] --> B[Return Canvas Result]
        B --> C["{ id, title, kind: 'canvas' }"]
    end

    subgraph "Message Processing"
        C --> D[Message Component Processes]
        D --> E{Check Tool Type}
        E -->|tool-requestA2AAgent| F[A2A Tool Handler]
        F --> G{Check Output Kind}
        G -->|kind === 'canvas'| H[DocumentToolResult]
        G -->|other| I[Generic A2A Result]
    end

    subgraph "Artifact Button Creation"
        H --> J[Create Clickable Button]
        J --> K["Button: 'Created Japan Trip Planning'"]
        K --> L[Add to Chat Message]
        L --> M[Display in Chat Interface]
    end

    subgraph "User Interaction"
        M --> N[User Sees Artifact Button]
        N --> O[User Clicks Button]
        O --> P[setArtifact Called]
        P --> Q["{ documentId, kind: 'canvas', isVisible: true }"]
    end

    subgraph "Canvas Reopening"
        Q --> R[Canvas Side Panel Opens]
        R --> S[onUpdateDocument Called]
        S --> T[Load Saved Canvas Content]
        T --> U[Parse Saved Task JSON]
        U --> V[Render Previously Created Tasks]
    end

    style A fill:#fff3e0
    style H fill:#e8f5e8
    style K fill:#f3e5f5
    style O fill:#ffe0b2
    style V fill:#4caf50
```

### 3. AI SDK v5 Streaming Pattern

```mermaid
sequenceDiagram
    participant Tool as 🛠️ Any Tool
    participant SDK as ⚙️ AI SDK
    participant Handler as 📝 Document Handler
    participant Artifact as 🎨 Artifact Client
    participant Component as 🖼️ UI Component

    Note over Tool,Handler: Standard AI SDK v5 Flow

    Tool->>SDK: 1. data-kind: 'type'
    Tool->>SDK: 2. data-id: documentId
    Tool->>SDK: 3. data-title: title
    Tool->>SDK: 4. data-clear: null

    SDK->>Handler: 5. onCreateDocument()
    Handler->>Handler: Generate/prepare content
    Handler->>SDK: 6. Stream content via data-*

    Tool->>SDK: 7. data-finish: null
    SDK->>Artifact: 8. onStreamPart(streamData)
    Artifact->>Artifact: 9. setArtifact(content)
    Artifact->>Component: 10. Render with content

    Note over Component: ✅ Content displays immediately

    rect rgb(232, 245, 232)
        Note over Tool,Component: Canvas follows this exact pattern
    end
```

### 4. Task Data Transformation Pipeline

```mermaid
graph LR
    subgraph "External A2A Format"
        A1[A2A Task Response] --> A2[Raw Task Objects]
        A2 --> A3["{ id, title, description, status, assignedAgent }"]
    end

    subgraph "Database Format"
        A3 --> B1[Database Task Schema]
        B1 --> B2[task table row]
        B2 --> B3[Stored with contextId]
    end

    subgraph "Canvas UI Format"
        A3 --> C1[Transform for Canvas]
        C1 --> C2[Map status: submitted → pending]
        C2 --> C3[Extract agent for visual display]
        C3 --> C4[UI-friendly task object]
    end

    subgraph "JSON Streaming"
        C4 --> D1[Canvas Data Object]
        D1 --> D2["{ tasks: [...], documentId, title }"]
        D2 --> D3[JSON.stringify for streaming]
        D3 --> D4[Stream via data-textDelta]
    end

    subgraph "Component Rendering"
        D4 --> E1[Canvas Artifact Receives]
        E1 --> E2[JSON.parse in Component]
        E2 --> E3[Map to CanvasFlow props]
        E3 --> E4[Render Task Nodes]
        E3 --> E5[Render Agent Cards]
        E3 --> E6[Render Connections]
    end

    style A1 fill:#e3f2fd
    style B2 fill:#fff3e0
    style D4 fill:#e8f5e8
    style E1 fill:#e8f5e8
    style E4 fill:#4caf50
    style E5 fill:#4caf50
    style E6 fill:#4caf50
```

## Error Handling & Edge Cases

### Error Flow Diagram

```mermaid
graph TD
    A[Canvas Creation Request] --> B{A2A Tool Success?}

    B -->|✅ Success| C[Tasks Created]
    B -->|❌ Fail| D[Show A2A Error]

    C --> E{Canvas Handler Available?}
    E -->|✅ Yes| F[Stream Task Data]
    E -->|❌ No| G[Handler Missing Error]

    F --> H{Valid Task Data?}
    H -->|✅ Yes| I[Canvas Renders Successfully]
    H -->|❌ No| J[Show Empty Canvas]

    I --> K[Success Toast Message]
    I --> L[Create Chat Artifact Button]
    I --> M[Enable Task Execution]

    J --> N["Display: No tasks available"]
    G --> O["Error: Canvas handler not found"]
    D --> P["Error: A2A tool failed"]

    style I fill:#4caf50
    style K fill:#4caf50
    style L fill:#f3e5f5
    style M fill:#4caf50
    style G fill:#ffebee
    style O fill:#ffebee
    style P fill:#ffebee
```

### Canvas State Machine

```mermaid
stateDiagram-v2
    [*] --> Initializing: User requests Canvas

    Initializing --> CreatingTasks: A2A tool called
    CreatingTasks --> TasksCreated: External API success
    CreatingTasks --> Error: External API failure

    TasksCreated --> StreamingToArtifact: Canvas handler invoked
    StreamingToArtifact --> ContentSet: data-textDelta received
    ContentSet --> RenderedInSidePanel: JSON parsed & displayed

    RenderedInSidePanel --> ButtonInChat: DocumentToolResult created
    ButtonInChat --> SavedInHistory: Added to chat history

    SavedInHistory --> ReopeningFromHistory: User clicks button later
    ReopeningFromHistory --> LoadingSavedContent: onUpdateDocument called
    LoadingSavedContent --> RenderedInSidePanel: Saved tasks displayed

    RenderedInSidePanel --> [*]: User closes Canvas
    Error --> [*]: Error handled

    note right of ContentSet
        Canvas receives complete
        task data via AI SDK streaming
    end note

    note right of ButtonInChat
        Artifact appears as clickable
        button in chat message
    end note
```

## Performance & Optimization

### Resource Utilization Flow

```mermaid
graph LR
    subgraph "Resource Efficiency"
        R1[Single API Call] --> R2[Batch Task Creation]
        R2 --> R3[One-Time JSON Streaming]
        R3 --> R4[Immediate Rendering]
        R4 --> R5[No Polling/Fetching]
    end

    subgraph "Memory Management"
        M1[Global Temp Storage] --> M2[Handler Processes]
        M2 --> M3[Clear Global Data]
        M3 --> M4[Artifact Content Only]
        M4 --> M5[Component Props]
    end

    subgraph "Performance Benefits"
        P1[Fast Canvas Creation] --> P2[Reduced Network Calls]
        P2 --> P3[Eliminated Race Conditions]
        P3 --> P4[Improved User Experience]
    end

    R1 --> M1
    M1 --> P1
    R5 --> P4

    style R4 fill:#e8f5e8
    style M4 fill:#e8f5e8
    style P4 fill:#4caf50
```

## Component Interaction Map

### Canvas Ecosystem

```mermaid
graph TB
    subgraph "Tools Layer"
        T1[requestA2AAgent]
        T2[createDocument]
        T3[updateDocument]
    end

    subgraph "Handlers Layer"
        H1[canvasDocumentHandler]
        H2[textDocumentHandler]
        H3[codeDocumentHandler]
    end

    subgraph "Artifacts Layer"
        A1[canvasArtifact]
        A2[textArtifact]
        A3[codeArtifact]
    end

    subgraph "Components Layer"
        C1[Canvas Component]
        C2[CanvasFlow]
        C3[Message Component]
        C4[DocumentToolResult]
    end

    subgraph "UI Layer"
        U1[Task Nodes]
        U2[Agent Cards]
        U3[Connections]
        U4[Chat Messages]
        U5[Artifact Buttons]
    end

    T1 --> H1
    T2 --> H2
    T3 --> H3

    H1 --> A1
    H2 --> A2
    H3 --> A3

    A1 --> C1
    A1 --> C3
    C1 --> C2
    C3 --> C4

    C2 --> U1
    C2 --> U2
    C2 --> U3
    C4 --> U5
    C3 --> U4

    style T1 fill:#fff3e0
    style H1 fill:#e8f5e8
    style A1 fill:#e8f5e8
    style C2 fill:#f3e5f5
    style U1 fill:#4caf50
    style U2 fill:#4caf50
    style U3 fill:#4caf50
```

## Data Flow Transformations

### Task Data Journey

```mermaid
graph TD
    subgraph "1. External API Response"
        A[Raw A2A Response] --> B[Task Array]
        B --> C["{ id, title, description, status, assignedAgent }"]
    end

    subgraph "2. Database Storage"
        C --> D[Task Database Schema]
        D --> E[Store with contextId]
        E --> F[Link to Canvas Document]
    end

    subgraph "3. Canvas UI Transformation"
        C --> G[UI Task Format]
        G --> H[Status Mapping]
        H --> I[Agent Extraction]
        I --> J[Canvas Task Object]
    end

    subgraph "4. JSON Serialization"
        J --> K[Canvas Data Structure]
        K --> L["{ tasks: [...], documentId: '...', title: '...' }"]
        L --> M[JSON.stringify()]
        M --> N[Ready for Streaming]
    end

    subgraph "5. AI SDK Streaming"
        N --> O[data-textDelta Stream]
        O --> P[Canvas Artifact Receives]
        P --> Q[setArtifact(content: JSON)]
        Q --> R[Content Prop Updated]
    end

    subgraph "6. Component Rendering"
        R --> S[JSON.parse(content)]
        S --> T[Extract tasks array]
        T --> U[Map to CanvasFlow props]
        U --> V[ReactFlow Nodes]
        V --> W[Visual Task Interface]
    end

    style A fill:#e3f2fd
    style E fill:#fff3e0
    style J fill:#ffe0b2
    style O fill:#e8f5e8
    style Q fill:#e8f5e8
    style W fill:#4caf50
```

### Canvas Lifecycle States

```mermaid
stateDiagram-v2
    [*] --> Requested: User asks for Canvas

    Requested --> Planning: A2A tool invoked
    Planning --> TasksCreated: External API success
    Planning --> Failed: External API error

    TasksCreated --> HandlerCalled: AI SDK invokes Canvas handler
    HandlerCalled --> ContentStreamed: data-textDelta sent
    ContentStreamed --> ArtifactUpdated: onStreamPart processes JSON

    ArtifactUpdated --> VisibleInSidePanel: Canvas component renders
    VisibleInSidePanel --> ButtonInChat: DocumentToolResult created
    ButtonInChat --> SavedInHistory: Persisted in database

    SavedInHistory --> ReopenedLater: User clicks artifact button
    ReopenedLater --> VisibleInSidePanel: onUpdateDocument loads content

    VisibleInSidePanel --> TasksExecuted: User executes agents
    TasksExecuted --> Completed: All tasks finished

    Completed --> [*]: Canvas closed
    Failed --> [*]: Error handled

    note right of ContentStreamed
        Critical step: Canvas handler
        must stream task data as JSON
    end note

    note right of ButtonInChat
        Canvas appears as clickable
        artifact in chat history
    end note
```

## AI SDK v5 Compliance Patterns

### Standard Artifact Pattern Implementation

```mermaid
graph LR
    subgraph "Text Artifact Pattern"
        T1[Text Tool] --> T2[Text Handler]
        T2 --> T3[data-textDelta]
        T3 --> T4[Text Artifact]
        T4 --> T5[Text Editor]
    end

    subgraph "Code Artifact Pattern"
        C1[Code Tool] --> C2[Code Handler]
        C2 --> C3[data-codeDelta]
        C3 --> C4[Code Artifact]
        C4 --> C5[Code Editor]
    end

    subgraph "Canvas Artifact Pattern"
        CA1[A2A Tool] --> CA2[Canvas Handler]
        CA2 --> CA3[data-textDelta]
        CA3 --> CA4[Canvas Artifact]
        CA4 --> CA5[CanvasFlow]
    end

    style T1 fill:#e3f2fd
    style C1 fill:#e3f2fd
    style CA1 fill:#fff3e0
    style T3 fill:#e8f5e8
    style C3 fill:#e8f5e8
    style CA3 fill:#e8f5e8
    style T5 fill:#4caf50
    style C5 fill:#4caf50
    style CA5 fill:#4caf50
```

## Success Metrics & Testing

### User Experience Flow Testing

```mermaid
graph TD
    subgraph "Happy Path Testing"
        H1[Create New Canvas] --> H2[Tasks Appear Immediately]
        H2 --> H3[Visual Interface Works]
        H3 --> H4[Artifact Button in Chat]
        H4 --> H5[Reopen from History]
        H5 --> H6[Saved Tasks Display]
    end

    subgraph "Edge Case Testing"
        E1[No Tasks Returned] --> E2[Empty Canvas State]
        E3[Invalid JSON] --> E4[Error Handling]
        E5[Handler Missing] --> E6[Graceful Degradation]
        E7[Network Timeout] --> E8[Timeout Error Display]
    end

    subgraph "Performance Testing"
        P1[Large Task Sets] --> P2[Render Performance]
        P3[Multiple Canvas] --> P4[Memory Usage]
        P5[Rapid Creation] --> P6[Resource Management]
    end

    style H2 fill:#4caf50
    style H6 fill:#4caf50
    style E2 fill:#ffe0b2
    style E4 fill:#ffe0b2
    style P2 fill:#f3e5f5
```

---

## Diagram Legend

| Color                        | Meaning                | Usage                               |
| ---------------------------- | ---------------------- | ----------------------------------- |
| 🔵 Blue (`#e3f2fd`)          | User Input/Interaction | Starting points, user actions       |
| 🟡 Yellow (`#fff3e0`)        | Data Processing        | Backend processing, transformations |
| 🟢 Green (`#e8f5e8`)         | AI SDK Integration     | Streaming, artifacts, handlers      |
| 🟣 Purple (`#f3e5f5`)        | UI Components          | Visual elements, buttons            |
| ✅ Success Green (`#4caf50`) | Successful Outcomes    | Working features, rendered content  |
| ❌ Error Red (`#ffebee`)     | Error States           | Failures, edge cases                |

## Documentation Index

- **`CANVAS_SYSTEM_OVERVIEW.md`** - High-level architecture and component interactions
- **`CANVAS_ARTIFACT_REFACTOR_PRD.md`** - Complete technical specification with implementation details
- **`CANVAS_FINAL_WORKING_SOLUTION.md`** - Root cause analysis and AI SDK sequence diagrams
- **`CANVAS_CHAT_HISTORY_INTEGRATION.md`** - Chat integration and reopening flows
- **`CANVAS_FLOW_DIAGRAMS.md`** - This comprehensive diagram collection

---

**Status**: Complete Architectural Documentation ✅  
**Pattern**: AI SDK v5 Compliant  
**Date**: January 2024  
**Coverage**: End-to-End System Flows
