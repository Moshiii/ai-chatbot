import { auth } from '@/app/(auth)/auth';
import { streamText, smoothStream } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { ChatSDKError } from '@/lib/errors';
import { generateUUID } from '@/lib/utils';

// Constants for agent creation constraints
const AGENT_NAME_MAX_LENGTH = 15;
const AGENT_DESCRIPTION_MAX_WORDS = 10;
const CAPABILITIES_COUNT = 3;
const MODEL_NAME = 'artifact-model';

// Agent creation prompt template
const AGENT_CREATION_PROMPT_TEMPLATE = (taskDescription: string) => `
You are an agent creation expert specialized in matching tasks with the most suitable AI agents. Based on the given task description, create a single specialized agent that would be perfect for handling this specific task.

Task Description: "${taskDescription}"

Please create a JSON structure with the following format:
{
  "name": "Agent Name",
  "description": "Brief description under ${AGENT_DESCRIPTION_MAX_WORDS} words", 
  "capabilities": ["Word1", "Word2", "Word3"]
}

Guidelines:
- Agent name must be short and descriptive (max ${AGENT_NAME_MAX_LENGTH} characters)
- Agent description must be concise and under ${AGENT_DESCRIPTION_MAX_WORDS} words total
- Include exactly ${CAPABILITIES_COUNT} single-word capabilities that would be needed for this task
- Each capability should be one word only (no spaces or hyphens)
- Be specific to the task requirements, not generic
- Make the agent feel specialized and purpose-built for this task
- Use realistic and practical capabilities
- Do NOT include "id" fields - these will be generated server-side

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
        
        // Generate UUID for the agent on the server side
        agentData.id = generateUUID();
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