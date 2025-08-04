import { createDocumentHandler } from '@/lib/artifacts/server';
import type { CreateDocumentCallbackProps, UpdateDocumentCallbackProps } from '@/lib/artifacts/server';
import { streamText, smoothStream } from 'ai';
import { myProvider } from '@/lib/ai/providers';

export const canvasDocumentHandler = createDocumentHandler({
  kind: 'canvas',
  onCreateDocument: async ({ id, title, dataStream }: CreateDocumentCallbackProps) => {
    // Use LLM to generate real task breakdown based on the title
    const taskBreakdownPrompt = `
You are an expert project manager and task decomposition specialist. Based on the given project or task title, create a comprehensive breakdown of tasks and appropriate agents to execute them.

Project/Task: "${title}"

Please create a JSON structure with the following format:
{
  "tasks": [
    {
      "id": "task-{unique-id}",
      "title": "Task Title",
      "description": "Detailed description of what this task involves",
      "status": "pending"
    }
  ],
  "agents": [
    {
      "id": "agent-{unique-id}", 
      "name": "Agent Name",
      "description": "Brief description under 10 words",
      "capabilities": ["Word1", "Word2", "Word3"]
    }
  ]
}

Guidelines:
- Create 3-6 meaningful tasks that break down the project
- Each task should be specific and actionable
- Create 2-4 specialized agents that can handle the tasks
- Agent names must be short and descriptive (max 15 characters)
- Agent descriptions must be concise and under 10 words total
- Include exactly 3 single-word capabilities for each agent
- Each capability should be one word only (no spaces or hyphens)
- Be realistic and practical in your breakdown
- Focus on the actual project requirements, not generic phases

Return only the JSON structure, no additional text.
`;

    let llmResponse = '';

    const { fullStream } = streamText({
      model: myProvider.languageModel('artifact-model'),
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
    const agents = canvasData.agents || [];
    
    // Start with empty data structure
    const initialData: {
      tasks: Array<{
        id: string;
        title: string;
        description: string;
        status: 'pending' | 'in-progress' | 'completed';
      }>;
      agents: Array<{
        id: string;
        name: string;
        description: string;
        capabilities: string[];
      }>;
    } = {
      tasks: [],
      agents: [], // Start with empty agents array
    };
    
    // Stream each task individually with a delay
    console.log(`Starting to stream ${tasks.length} tasks...`);
    
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      
      // Generate unique task ID
      const uniqueTaskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const taskWithUniqueId = { ...task, id: uniqueTaskId };
      
      console.log(`Streaming task ${i + 1}/${tasks.length}: ${task.title} with ID: ${uniqueTaskId}`);
      
      // Stream only the new task as incremental data
      dataStream.write({
        type: 'data-textDelta',
        data: JSON.stringify({ newTask: taskWithUniqueId }, null, 2),
        transient: true,
      });
      
      // Add a small delay between tasks for visual effect
      if (i < tasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 800)); // 800ms delay between tasks
      }
    }
    
    console.log('Finished streaming all tasks');
    
    // Return the final complete data structure
    return JSON.stringify(initialData, null, 2);
  },
  onUpdateDocument: async ({ document, description, dataStream }: UpdateDocumentCallbackProps) => {
    // For canvas updates, we'll append the description to the existing content
    const existingData = document.content ? JSON.parse(document.content) : { tasks: [], agents: [] };
    
    // Add a new task based on the description
    const newTask = {
      id: `task-${Date.now()}`,
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