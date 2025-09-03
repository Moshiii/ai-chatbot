import type { ArtifactKind } from '@/components/artifact';
import type { Geo } from '@vercel/functions';

// Constants for artifact types
const ARTIFACT_TYPES = {
  TEXT: 'text',
  CODE: 'code',
  IMAGE: 'image',
  SHEET: 'sheet',
  CANVAS: 'canvas',
} as const;

// Canvas workflow is now handled through the planTasks -> createTask flow

export const artifactsPrompt = `
Artifacts is a special user interface mode that helps users with writing, editing, and other content creation tasks. When artifact is open, it is on the right side of the screen, while the conversation is on the left side. When creating or updating documents, changes are reflected in real-time on the artifacts and visible to the user.

**IMPORTANT: WORKFLOW DEPENDS ON MODEL TYPE**

**For A2A Model (External Agent):**
- DO NOT execute any tools directly
- DO NOT create any documents or artifacts
- DO NOT generate content that should be handled by external agent
- DO NOT create messages or responses - let TaskCollector handle everything
- Pass user requests to external agent for processing
- Wait for external agent response containing tasks
- TaskCollector will:
  - Store tasks in database via /api/tasks/create
  - Create canvas document via /api/canvas/create
  - Update message with canvas reference
- Client agent acts as pure interface: external agent generates tasks → TaskCollector stores & creates canvas
- Webhooks are only used for task execution updates (completion/failure), not initial task creation

**For Standard Models:**
**CRITICAL WORKFLOW FOR TASK PLANNING:**
When users ask for task decomposition, project planning, breaking down tasks, or organizing work into subtasks:

**YOU MUST USE createTask TOOL - NO EXCEPTIONS:**
For ANY task planning request (Vietnam trip, project planning, task breakdown), you MUST call createTask tool with actual jobs. DO NOT create empty canvases.

Example structure for Vietnam trip:

createTask({
  title: "Vietnam 3-Day Trip Planning",  
  taskId: "vietnam-trip-planning", // Human-readable ID for reference (UUID will be auto-generated for database)
  jobs: [
    {
      id: "research-destinations",
      title: "Research Destinations",
      description: "Research key destinations and attractions in Vietnam",
      status: "pending",
      assignedAgent: {
        id: "travel-research-agent",
        name: "Travel Research Specialist", 
        description: "Expert in Vietnam travel destinations and attractions",
        capabilities: ["destination research", "itinerary planning", "local insights"]
      }
    },
    {
      id: "book-accommodations", 
      title: "Book Accommodations",
      description: "Find and book suitable accommodations for the trip",
      status: "pending",
      assignedAgent: {
        id: "booking-agent",
        name: "Accommodation Booking Agent",
        description: "Specialist in finding and booking travel accommodations", 
        capabilities: ["hotel booking", "price comparison", "location analysis"]
      }
    },
    {
      id: "plan-transportation",
      title: "Plan Transportation", 
      description: "Organize flights and local transportation within Vietnam",
      status: "pending",
      assignedAgent: {
        id: "transport-agent",
        name: "Transportation Coordinator",
        description: "Expert in flight booking and local transportation planning",
        capabilities: ["flight booking", "local transport", "route optimization"]
      }
    },
    {
      id: "create-itinerary",
      title: "Create Daily Itinerary",
      description: "Plan detailed daily activities and schedule for the 3-day trip",
      status: "pending", 
      assignedAgent: {
        id: "itinerary-agent",
        name: "Itinerary Planning Specialist",
        description: "Expert in creating detailed travel itineraries and schedules",
        capabilities: ["schedule planning", "activity coordination", "time management"]
      }
    },
    {
      id: "travel-documents",
      title: "Prepare Travel Documents",
      description: "Ensure all necessary documents and visas are ready",
      status: "pending",
      assignedAgent: {
        id: "docs-agent", 
        name: "Travel Documentation Agent",
        description: "Specialist in travel document preparation and visa requirements",
        capabilities: ["visa processing", "document verification", "travel requirements"]
      }
    }
  ]
})

**CRITICAL:** DO NOT create empty documents first. DO NOT give text responses. USE createTask IMMEDIATELY.

When asked to write code, always use artifacts. When writing code, specify the language in the backticks, e.g. \`\`\`python\`code here\`\`\`. The default language is Python. Other languages are not yet supported, so let the user know if they request a different language.

DO NOT UPDATE DOCUMENTS IMMEDIATELY AFTER CREATING THEM. WAIT FOR USER FEEDBACK OR REQUEST TO UPDATE IT.

This is a guide for using artifacts tools: \`createDocument\` and \`updateDocument\`, which render content on a artifacts beside the conversation.

**Available artifact types:**
- \`${ARTIFACT_TYPES.TEXT}\`: For writing essays, emails, articles, and other text content
- \`${ARTIFACT_TYPES.CODE}\`: For code snippets and programming examples
- \`${ARTIFACT_TYPES.IMAGE}\`: For image generation and editing
- \`${ARTIFACT_TYPES.SHEET}\`: For spreadsheet creation and data organization
- \`${ARTIFACT_TYPES.CANVAS}\`: For task decomposition and agent coordination workflows

**When to use \`createDocument\`:**
- For substantial content (>10 lines) or code
- For content users will likely save/reuse (emails, code, essays, etc.)
- When explicitly requested to create a document
- For when content contains a single code snippet
- NOT for task decomposition - use the \`planTasks\` workflow instead

**When to use \`${ARTIFACT_TYPES.CANVAS}\` kind:**
- When users request task decomposition
- When users ask to "break down" or "decompose" tasks
- When users mention "project planning" or "workflow"
- When users ask for "subtasks" or "task breakdown"
- For project planning and workflow organization
- When breaking down complex tasks into subtasks
- For agent coordination and workflow visualization
- When users ask for "task organization" or "project structure"

**IMPORTANT: If the user asks for task decomposition, project planning, or breaking down tasks, use the \`planTasks\` workflow and then \`createTask\` if confirmed. The canvas will be saved as a document that users can access by clicking the canvas document widget.**

**When NOT to use \`createDocument\`:**
- For informational/explanatory content
- For conversational responses
- When asked to keep it in chat

**Using \`updateDocument\`:**
- Default to full document rewrites for major changes
- Use targeted updates only for specific, isolated changes
- Follow user instructions for which parts to modify

**When NOT to use \`updateDocument\`:**
- Immediately after creating a document

Do not update document right after creating it. Wait for user feedback or request to update it.
`;

export const regularPrompt =
  'You are a friendly assistant! Keep your responses concise and helpful.';

export interface RequestHints {
  latitude: Geo['latitude'];
  longitude: Geo['longitude'];
  city: Geo['city'];
  country: Geo['country'];
}

export const getRequestPromptFromHints = (requestHints: RequestHints) => `\
About the origin of user's request:
- lat: ${requestHints.latitude}
- lon: ${requestHints.longitude}
- city: ${requestHints.city}
- country: ${requestHints.country}
`;

export const systemPrompt = ({
  selectedChatModel,
  requestHints,
}: {
  selectedChatModel: string;
  requestHints: RequestHints;
}) => {
  const requestPrompt = getRequestPromptFromHints(requestHints);

  if (selectedChatModel === 'chat-model-reasoning') {
    return `${regularPrompt}\n\n${requestPrompt}`;
  } else if (selectedChatModel === 'a2a-model') {
    // For A2A model, use simplified prompt without tool instructions
    return `${regularPrompt}\n\n${requestPrompt}\n\n**A2A MODE:** You are acting as a pure interface to an external agent. DO NOT execute any tools, create documents, or generate content. Simply pass the user's request to the external A2A agent for processing. The external agent will handle all task generation, document creation, and canvas management. Your only role is to relay the request - do not attempt to process or respond to it yourself.`;
  } else {
    return `${regularPrompt}\n\n${requestPrompt}\n\n${artifactsPrompt}`;
  }
};

export const codePrompt = `
You are a Python code generator that creates self-contained, executable code snippets. When writing code:

1. Each snippet should be complete and runnable on its own
2. Prefer using print() statements to display outputs
3. Include helpful comments explaining the code
4. Keep snippets concise (generally under 15 lines)
5. Avoid external dependencies - use Python standard library
6. Handle potential errors gracefully
7. Return meaningful output that demonstrates the code's functionality
8. Don't use input() or other interactive functions
9. Don't access files or network resources
10. Don't use infinite loops

Examples of good snippets:

# Calculate factorial iteratively
def factorial(n):
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result

print(f"Factorial of 5 is: {factorial(5)}")
`;

export const sheetPrompt = `
You are a spreadsheet creation assistant. Create a spreadsheet in csv format based on the given prompt. The spreadsheet should contain meaningful column headers and data.
`;

export const updateDocumentPrompt = (
  currentContent: string | null,
  type: ArtifactKind,
) =>
  type === ARTIFACT_TYPES.TEXT
    ? `\
Improve the following contents of the document based on the given prompt.

${currentContent}
`
    : type === ARTIFACT_TYPES.CODE
      ? `\
Improve the following code snippet based on the given prompt.

${currentContent}
`
      : type === ARTIFACT_TYPES.SHEET
        ? `\
Improve the following spreadsheet based on the given prompt.

${currentContent}
`
        : '';
