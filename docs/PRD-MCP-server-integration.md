# PRD: External MCP Server Integration

## 1. Product overview

### 1.1 Document title and version

- PRD: External MCP Server Integration
- Version: 3.0

### 1.2 Product summary

This project will integrate an external Multi-Agent Communication Protocol (MCP) server into our AI chatbot application. The integration will allow our primary agent to connect to a network of specialized external agents, dynamically discover their capabilities, and delegate complex tasks to them. This will significantly extend the chatbot's abilities without requiring the development of these specialized skills in-house.

The core of this project is a dynamic integration that aligns with MCP best practices. Instead of creating a simple gateway, the system will fetch available tools from the MCP server at runtime and make them directly available to our agent. This ensures that our chatbot can seamlessly and intelligently leverage a growing network of external tools, providing more accurate and comprehensive responses to users.

## 2. Goals

### 2.1 Business goals

- Extend the chatbot's capabilities by leveraging a network of external, specialized AI agents.
- Reduce the time and cost of developing new features by integrating pre-existing tools from the MCP server.
- Increase user engagement and satisfaction by providing more powerful and versatile tools.

### 2.2 User goals

- Get answers to complex questions that require specialized knowledge (e.g., trend analysis, data analysis).
- Accomplish tasks that the core agent cannot handle on its own.
- Experience a seamless interaction where the chatbot intelligently delegates tasks to the appropriate specialist agent.

### 2.3 Non-goals

- Building or hosting our own MCP server.
- A user-facing interface for managing or selecting MCP agents. The delegation will be handled automatically by the primary AI agent.
- Replacing all existing native tools with MCP agents.

## 3. User personas

### 3.1 Key user types

- End-User
- Developer

### 3.2 Basic persona details

- **End-User**: A user of the chatbot who wants to accomplish a complex task that requires specialized knowledge or tools. They expect a seamless experience and a useful response.
- **Developer**: A software engineer on the team responsible for implementing and aintaining the chatbot's features, including the integration with the MCP server.

### 3.3 Role-based access

- **End-User**: Any authenticated user of the chatbot can interact with the system. Their prompts may trigger the use of an MCP agent, but they have no direct control over this process.

## 4. Functional requirements

- **MCP Server Connection** (Priority: High)
  - The application must be able to connect to the external MCP server using a URL provided in an environment variable (`ISEK_MCP_SERVER_URL`).
- **Dynamic Tool Discovery** (Priority: High)
  - The system must query the MCP server to fetch a list of available agents and their schemas (description, input parameters).
- **Tool Invocation** (Priority: High)
  - The primary AI agent must be able to invoke any of the discovered MCP agents and pass the required inputs.
- **Displaying Results** (Priority: High)
  - The results from the MCP agents must be clearly displayed to the user within the chat interface.
- **Error Handling** (Priority: High)
  - The system must gracefully handle scenarios where the MCP server is unavailable or an individual agent fails.

## 5. User experience

### 5.1. Entry points & first-time user flow

- If the user's request is best handled by a specialized agent, the primary agent will automatically delegate the task. The user does not need to do anything special to trigger this.

### 5.2. Core experience

- **User sends a prompt**: A user asks a question like, "What are the current trends in the electric vehicle market?"
- **Agent delegates**: The primary agent determines that this query is best handled by the `trending_agent` from the MCP network. The UI may display a message like, "Consulting the market trend specialist..."
- **Agent presents results**: The `trending_agent` processes the request and returns its findings. The primary agent then formats this information and presents it to the user in a clear and readable way.

### 5.3. Advanced features & edge cases

- If the MCP server cannot be reached, the agent should inform the user that it cannot access its specialized tools at the moment.
- If a specific MCP agent fails to execute a request, the primary agent should report the failure to the user and suggest trying a different approach.
- The system should have a reasonable timeout for requests to MCP agents to prevent long waits.

### 5.4. UI/UX highlights

- **Transparent Delegation**: The user will be subtly informed when the agent is consulting an external specialist, which manages expectations.
- **Clear Presentation**: The results from external agents will be displayed in a clean format, such as a markdown block or a code block, to distinguish them from regular chat messages.

## 6. Narrative

Sarah, a market analyst, needs to quickly understand emerging trends in renewable energy for a report. She asks the AI chatbot, "What are the latest trends in solar panel technology?". The chatbot recognizes this specialized query and seamlessly consults an external `trending_agent`. Within seconds, it provides Sarah with a concise, up-to-date summary, saving her hours of research. The experience is smooth and powerful, making the chatbot an indispensable tool in her workflow.

## 7. Success metrics

### 7.1. User-centric metrics

- Frequency of MCP tool usage.
- User satisfaction ratings for responses that used MCP tools.
- Reduction in "I can't answer that" or unhelpful responses from the agent.

### 7.2. Business metrics

- Increased user engagement and session duration.
- Positive feedback from users regarding the expanded capabilities of the chatbot.

### 7.3. Technical metrics

- Latency of MCP tool discovery and invocation.
- Error rate of calls to the MCP server.
- Successful integration of new MCP agents without requiring code changes.

## 8. Technical considerations

### 8.1. Integration points

- The primary integration point is between our Next.js backend and the external MCP server via HTTPS requests.

### 8.2. Data storage & privacy

- We must ensure that no sensitive or personally identifiable information is sent to the MCP server without a clear privacy policy in place.
- Initially, the results from MCP agents will not be stored in our database.

### 8.3. Scalability & performance

- The performance of the MCP server is an external dependency. We should monitor its responsiveness.
- The tool discovery mechanism should be efficient. Caching the list of tools for a short period (e.g., a few minutes) can reduce latency.

### 8.4. Potential challenges

- The MCP server's API is not officially documented and may change. We will need to be prepared to adapt our client.
- The dynamic conversion of JSON schemas from the server to Zod schemas in our application may encounter edge cases.
- Network reliability between our application and the external MCP server could be a factor.

## 9. Implementation Guide: Chat Client

This guide provides a step-by-step checklist for integrating the external MCP server into our Next.js application.

### Phase 1: MCP Client & Tool Generation (Backend)

#### Step 1.1: Add Dependencies

- **File**: `package.json`
- **Action**: Add the `json-schema-to-zod` dependency by running `pnpm install json-schema-to-zod`.

#### Step 1.2: Create the MCP Client Module

- **File**: `lib/mcp/client.ts` (Create this new file)
- **Action**: Add the following code. This module will handle all communication with the MCP server.

  ```typescript
  import { tool } from "ai";
  import { z } from "zod";
  import { fromSchema } from "json-schema-to-zod";
  import type { UIMessage, UIMessageStreamWriter } from "ai";
  import type { AppSession, ChatTools } from "@/lib/types";

  interface McpAgentDefinition {
    name: string;
    description: string;
    input_schema: any; // JSON Schema
  }

  interface GetMcpToolsProps {
    session: AppSession;
    dataStream: UIMessageStreamWriter<UIMessage>;
  }

  export async function getMcpTools({
    session,
    dataStream,
  }: GetMcpToolsProps): Promise<ChatTools> {
    const mcpServerUrl = process.env.ISEK_MCP_SERVER_URL;
    if (!mcpServerUrl) {
      console.log(
        "[MCP Client] ISEK_MCP_SERVER_URL not set. MCP tools disabled."
      );
      return {};
    }

    try {
      const response = await fetch(`${mcpServerUrl}/agents`);
      if (!response.ok) {
        throw new Error(`Failed to fetch agents: ${response.statusText}`);
      }
      const agentDefinitions: McpAgentDefinition[] = await response.json();
      const mcpTools: ChatTools = {};

      for (const agent of agentDefinitions) {
        const zodSchemaString = await fromSchema(agent.input_schema);
        const inputSchema = eval(`z.object(${zodSchemaString})`);

        mcpTools[agent.name] = tool({
          description: agent.description,
          inputSchema,
          execute: async (args: any) => {
            try {
              const invokeResponse = await fetch(`${mcpServerUrl}/invoke`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agent_name: agent.name,
                  agent_inputs: args,
                }),
              });
              if (!invokeResponse.ok) {
                throw new Error(
                  `Agent returned an error: ${invokeResponse.statusText}`
                );
              }
              return await invokeResponse.json();
            } catch (error: any) {
              return { error: error.message };
            }
          },
        });
      }
      return mcpTools;
    } catch (error: any) {
      console.error("[MCP Client] Failed to discover tools:", error);
      return {};
    }
  }
  ```

### Phase 2: Integration with Chat API (Backend)

#### Step 2.1: Integrate Dynamic Tools into the Chat API

- **File**: `app/(chat)/api/chat/route.ts`
- **Action**: Modify the `POST` function to call `getMcpTools` and merge the result with the existing tools.

  ```typescript
  // At top of file
  import { getMcpTools } from "@/lib/mcp/client";

  // ... inside the `execute` block of `createUIMessageStream`
  const mcpTools = await getMcpTools({ session, dataStream });

  const result = streamText({
    // ...
    tools: {
      getWeather,
      // ... other native tools
      ...mcpTools,
    },
    // ...
  });
  ```

### Phase 3: Environment and Testing

#### Step 3.1: Configure Environment Variables

- **File**: `.env.local`
- **Action**: Add the `ISEK_MCP_SERVER_URL`.
  ```
  ISEK_MCP_SERVER_URL=http://127.0.0.1:8000
  ```

## 10. Implementation Guide: ISEK MCP Server Alignment

For the integration to be successful, the `ISEK_MCP` server must adhere to the following contract. This section outlines the required endpoints and data structures that the server needs to expose.

### 10.1. Implement a Discovery Endpoint: `GET /agents`

The server must provide an endpoint that returns a list of all available agents and their capabilities.

- **Endpoint**: `GET /agents`
- **Success Response**: A JSON array where each object represents an agent and contains its `name`, `description`, and a valid `input_schema` compliant with JSON Schema.
- **Example Response Body**:
  ```json
  [
    {
      "name": "trending_agent",
      "description": "Analyzes and reports on trending topics.",
      "input_schema": {
        "type": "object",
        "properties": {
          "topic": {
            "type": "string",
            "description": "The topic to analyze for trends."
          }
        },
        "required": ["topic"]
      }
    }
  ]
  ```

### 10.2. Standardize the Invocation Endpoint: `POST /invoke`

The server must provide a single endpoint for executing any of its agents.

- **Endpoint**: `POST /invoke`
- **Request Body**: A JSON object containing `agent_name` and the `agent_inputs` object.
- **Example Request Body**:
  ```json
  {
    "agent_name": "trending_agent",
    "agent_inputs": {
      "topic": "Renewable Energy"
    }
  }
  ```
- **Success Response**: The JSON output from the invoked agent.

## 11. User Stories

### 11.1. Discover available MCP agents

- **ID**: US-001
- **Description**: As a developer, I want the system to dynamically discover tools from the MCP server so that new capabilities can be added without code changes.
- **Acceptance criteria**:
  - The application sends a request to the MCP server's discovery endpoint on startup or when a chat session begins.
  - The application correctly parses the list of agents and their schemas from the server's response.
  - An AI SDK v5-compatible tool is generated for each agent returned by the server.

### 11.2. Delegate a task to an MCP agent

- **ID**: US-002
- **Description**: As a user, I want the AI agent to be able to use external specialist agents so that I can get answers to complex questions.
- **Acceptance criteria**:
  - The primary AI agent can identify when a user's prompt is best handled by a dynamically discovered MCP tool.
  - The agent successfully calls the `execute` function of the correct tool with the appropriate parameters.
  - The `execute` function sends a correctly formatted request to the MCP server's invocation endpoint.

### 11.3. View results from an MCP agent

- **ID**: US-003
- **Description**: As a user, I want to see the results from the specialist agent clearly presented in the chat.
- **Acceptance criteria**:
  - The response from the MCP server is successfully parsed.
  - The result is returned from the tool's `execute` function.
  - The primary agent presents the result to the user in the chat interface, formatted for readability.

### 11.4. Handle MCP server unavailability

- **ID**: US-004
- **Description**: As a user, I want to receive a graceful message if the specialist agent network is unavailable, so that I'm not left with a broken experience.
- **Acceptance criteria**:
  - If the request to the MCP server's discovery endpoint fails, the integration is gracefully disabled.
  - If an invocation request fails due to a network error, the agent informs the user that it was unable to reach the specialist agent.
  - The primary agent should attempt to answer the user's question on its own if the MCP integration is unavailable.
