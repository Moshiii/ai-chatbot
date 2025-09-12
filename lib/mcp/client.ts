import { tool } from 'ai';
import { z } from 'zod';
import { jsonSchemaToZod } from 'json-schema-to-zod';
import type { UIMessage, UIMessageStreamWriter } from 'ai';
import type { AppSession, ChatTools } from '@/lib/types';

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
      '[MCP Client] ISEK_MCP_SERVER_URL not set. MCP tools disabled.',
    );
    return {};
  }

  try {
    const response = await fetch(`${mcpServerUrl}/agents`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000), // 5 second timeout for discovery
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }

    const agentDefinitions: McpAgentDefinition[] = await response.json();
    const mcpTools: ChatTools = {};

    for (const agent of agentDefinitions) {
      try {
        // Sanitize tool name to meet OpenAI API requirements (only alphanumeric, underscore, hyphen)
        const sanitizedName = agent.name
          .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid chars with underscore
          .replace(/_+/g, '_') // Replace multiple underscores with single
          .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores

        // Skip if sanitized name is empty
        if (!sanitizedName) {
          console.warn(
            `[MCP Client] Skipping agent with invalid name: '${agent.name}'`,
          );
          continue;
        }

        // Handle duplicate sanitized names
        if (mcpTools[sanitizedName]) {
          console.warn(
            `[MCP Client] Duplicate sanitized name '${sanitizedName}' for agent '${agent.name}', skipping`,
          );
          continue;
        }

        // Convert JSON Schema to Zod schema string, then evaluate it
        const zodSchemaString = jsonSchemaToZod(agent.input_schema);
        // Use Function constructor for safer eval alternative
        const createSchema = new Function('z', `return ${zodSchemaString}`);
        const inputSchema = createSchema(z);

        mcpTools[sanitizedName] = tool({
          description: `${agent.description} (External MCP Agent: ${agent.name}). Use when the user asks for ${agent.name.toLowerCase()}-related analysis or actions.`,
          inputSchema: inputSchema,
          execute: async (args: any) => {
            console.log(
              `[MCP Client] ▶️ Calling agent '${agent.name}' with args:`,
              args,
            );
            try {
              const invokeResponse = await fetch(`${mcpServerUrl}/invoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  agent_name: agent.name,
                  agent_inputs: args,
                }),
                signal: AbortSignal.timeout(30000), // 30 second timeout for execution
              });

              if (!invokeResponse.ok) {
                const errorText = await invokeResponse.text();
                throw new Error(
                  `Agent '${agent.name}' error (${invokeResponse.status}): ${errorText}`,
                );
              }

              const result = await invokeResponse.json();
              console.log(`[MCP Client] ✅ Agent '${agent.name}' succeeded`);

              // Return the actual content directly so the LLM can process and present it
              // If result is a string, return it directly; if it's an object, stringify it
              if (typeof result === 'string') {
                return result;
              } else if (result && typeof result === 'object') {
                // If it's a structured response, try to extract the main content
                if ((result as any).content) {
                  return result.content;
                } else if ((result as any).response) {
                  return result.response;
                } else if ((result as any).data) {
                  return typeof result.data === 'string'
                    ? result.data
                    : JSON.stringify(result.data, null, 2);
                } else if (
                  (result as any).result &&
                  typeof (result as any).result === 'object' &&
                  (result as any).result.parts &&
                  Array.isArray((result as any).result.parts)
                ) {
                  // Extract concatenated text from MCP-style result.message.parts
                  const parts = (result as any).result.parts as Array<any>;
                  const text = parts
                    .filter((p) => p && (p.text || p.content || p.value))
                    .map((p) => p.text || p.content || p.value)
                    .join('\n\n');
                  if (text) return text;
                  return JSON.stringify((result as any).result, null, 2);
                } else {
                  return JSON.stringify(result, null, 2);
                }
              } else {
                return `Agent ${agent.name} completed successfully but returned no content.`;
              }
            } catch (error: any) {
              console.error(
                `[MCP Client] ❌ Agent '${agent.name}' failed:`,
                error,
              );
              return `Error: Agent ${agent.name} failed - ${error.message}`;
            }
          },
        });

        console.log(
          `[MCP Client] Successfully registered tool: '${sanitizedName}' (original: '${agent.name}')`,
        );
      } catch (error: any) {
        console.error(
          `[MCP Client] Failed to create tool for agent '${agent.name}':`,
          error,
        );
        // Continue with other agents even if one fails
      }
    }

    console.log(
      `[MCP Client] Successfully registered ${Object.keys(mcpTools).length} MCP tools`,
    );
    return mcpTools;
  } catch (error: any) {
    console.error('[MCP Client] Failed to discover MCP tools:', error);
    return {};
  }
}
