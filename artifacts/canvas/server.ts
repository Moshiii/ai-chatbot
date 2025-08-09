import { createDocumentHandler } from '@/lib/artifacts/server';
import type { CreateDocumentCallbackProps, UpdateDocumentCallbackProps } from '@/lib/artifacts/server';
import { streamText, smoothStream } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { generateUUID } from '@/lib/utils';

// Constants for task breakdown constraints
const TASK_BREAKDOWN_CONSTRAINTS = {
  AGENT_NAME_MAX_LENGTH: 15,
  AGENT_DESCRIPTION_MAX_WORDS: 10,
  CAPABILITIES_COUNT: 3,
  TASK_STREAMING_DELAY: 800,
} as const;

const MODEL_NAME = 'artifact-model';

// Task breakdown prompt template
const TASK_BREAKDOWN_PROMPT_TEMPLATE = (title: string) => `
You are an expert project manager and task decomposition specialist. Based on the given project or task title, create a comprehensive breakdown of tasks and appropriate agents to execute them.

Project/Task: "${title}"

Please create a JSON structure with the following format:
{
  "tasks": [
    {
      "title": "Task Title",
      "description": "Detailed description of what this task involves",
      "status": "pending"
    }
  ]
}

Guidelines:
- Create as many meaningful tasks as needed to thoroughly break down the project
- Each task should be specific and actionable
- Be realistic and practical in your breakdown
- Focus on the actual project requirements, not generic phases
- Do NOT include "id" fields - these will be generated server-side
- Do NOT include agents - they will be created separately when needed

Return only the JSON structure, no additional text.
`;

// Remove the custom ID generation function since we'll use UUID
// const generateUniqueTaskId = () => 
//   `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const canvasDocumentHandler = createDocumentHandler({
  kind: 'canvas',
  onCreateDocument: async ({ id, title, dataStream }: CreateDocumentCallbackProps) => {
    // Use LLM to generate real task breakdown based on the title
    const taskBreakdownPrompt = TASK_BREAKDOWN_PROMPT_TEMPLATE(title);

    let llmResponse = '';

    const { fullStream } = streamText({
      model: myProvider.languageModel(MODEL_NAME),
      system: 'You are a task decomposition expert. Always respond with valid JSON only.',
      experimental_transform: smoothStream({ chunking: 'word' }),
      prompt: taskBreakdownPrompt,
    });

    for await (const delta of fullStream) {
      const { type } = delta;

      if (type === 'text') {
        const { text } = delta;
        llmResponse += text;
      }
    }

    // Parse the LLM response to get the task breakdown
    let canvasData;
    try {
      // Clean the response to extract JSON
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        canvasData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      throw new Error(`Failed to generate task breakdown for "${title}". Please try again.`);
    }

    // Stream tasks one by one for better UX
    const tasks = canvasData.tasks || [];
    
    // Start with empty data structure
    const initialData: {
      tasks: Array<{
        id: string;
        title: string;
        description: string;
        status: 'pending' | 'in-progress' | 'completed';
      }>;
    } = {
      tasks: [],
    };
    
    // Stream each task individually with a delay
    console.log(`Starting to stream ${tasks.length} tasks...`);
    
    const finalTasks = [];
    
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      
      // Generate UUID for the task
      const uniqueTaskId = generateUUID();
      const taskWithUniqueId = { ...task, id: uniqueTaskId };
      
      // Add to final tasks array
      finalTasks.push(taskWithUniqueId);
      
      console.log(`Streaming task ${i + 1}/${tasks.length}: ${task.title} with ID: ${uniqueTaskId}`);
      
      // Stream only the new task as incremental data
      dataStream.write({
        type: 'data-textDelta',
        data: JSON.stringify({ newTask: taskWithUniqueId }, null, 2),
        transient: true,
      });
      
      // Add a small delay between tasks for visual effect
      if (i < tasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, TASK_BREAKDOWN_CONSTRAINTS.TASK_STREAMING_DELAY));
      }
    }
    
    console.log('Finished streaming all tasks');
    
    // Build the final complete data structure with all tasks
    const finalData = {
      tasks: finalTasks,
      agents: [], // Agents will be created separately when needed
    };
    
    // Return the final complete data structure
    return JSON.stringify(finalData, null, 2);
  },
  onUpdateDocument: async ({ document, description, dataStream }: UpdateDocumentCallbackProps) => {
    // For canvas updates, we'll append the description to the existing content
    const existingData = document.content ? JSON.parse(document.content) : { tasks: [], agents: [] };
    
    // Add a new task based on the description
    const newTask = {
      id: generateUUID(),
      title: `New Task - ${new Date().toLocaleTimeString()}`,
      description: description || 'Task added via update',
      status: 'pending' as const,
    };

    existingData.tasks.push(newTask);

    // Stream the updated data
    dataStream.write({
      type: 'data-textDelta',
      data: JSON.stringify(existingData, null, 2),
      transient: true,
    });

    return JSON.stringify(existingData, null, 2);
  },
}); 