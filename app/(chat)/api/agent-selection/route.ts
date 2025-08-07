import { auth } from '@/app/(auth)/auth';
import { streamText, smoothStream } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { ChatSDKError } from '@/lib/errors';

// Constants for agent creation constraints
const AGENT_NAME_MAX_LENGTH = 15;
const AGENT_DESCRIPTION_MAX_WORDS = 10;
const CAPABILITIES_COUNT = 3;
const MODEL_NAME = 'artifact-model';

// Agent creation prompt template
const AGENT_CREATION_PROMPT_TEMPLATE = (taskDescription: string) => `
You are an expert at creating specialized AI agents for specific tasks. Based on the given task description, create a new agent that would be perfectly suited to handle this task.

Task Description: "${taskDescription}"

Please create a JSON structure for a new agent with the following format:
{
  "id": "agent-{unique-id}",
  "name": "Descriptive Agent Name",
  "description": "Brief description under ${AGENT_DESCRIPTION_MAX_WORDS} words",
  "capabilities": ["Word1", "Word2", "Word3"]
}

Guidelines:
- The agent name should be descriptive and reflect its specialization (max ${AGENT_NAME_MAX_LENGTH} characters)
- The description must be concise and under ${AGENT_DESCRIPTION_MAX_WORDS} words total
- Include exactly ${CAPABILITIES_COUNT} single-word capabilities that would be needed for this task
- Each capability should be one word only (no spaces or hyphens)
- Be specific to the task requirements, not generic
- Make the agent feel specialized and purpose-built for this task
- Use realistic and practical capabilities

Return only the JSON structure, no additional text.
`;

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:auth').toResponse();
  }

  try {
    const { taskDescription } = await request.json();

    if (!taskDescription) {
      return new ChatSDKError(
        'bad_request:api',
        'Parameter taskDescription is required.',
      ).toResponse();
    }

    // Use LLM to analyze the task and create a matching agent
    const agentCreationPrompt = AGENT_CREATION_PROMPT_TEMPLATE(taskDescription);

    let llmResponse = '';

    const { fullStream } = streamText({
      model: myProvider.languageModel(MODEL_NAME),
      system: 'You are an agent creation expert. Always respond with valid JSON only.',
      experimental_transform: smoothStream({ chunking: 'word' }),
      prompt: agentCreationPrompt,
    });

    for await (const delta of fullStream) {
      const { type } = delta;

      if (type === 'text') {
        const { text } = delta;
        llmResponse += text;
      }
    }

    // Parse the LLM response to get the agent data
    let agentData;
    try {
      // Clean the response to extract JSON
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        agentData = JSON.parse(jsonMatch[0]);
        
        // Ensure the agent has a unique ID (the client will override this, but just in case)
        if (!agentData.id) {
          agentData.id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      throw new ChatSDKError(
        'bad_request:api',
        `Failed to generate agent for task: "${taskDescription}". Please try again.`
      );
    }

    return Response.json(agentData, { status: 200 });

  } catch (error) {
    console.error('Agent selection error:', error);
    
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    
    return new ChatSDKError(
      'bad_request:api',
      'Failed to process agent selection request.'
    ).toResponse();
  }
} 