import { tool, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import { streamText, smoothStream } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import type { ChatMessage } from '@/lib/types';
import type { Session } from 'next-auth';

interface PlanTasksProps {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

// No longer constraining task count - let AI determine optimal number

const TASK_PLANNING_PROMPT_TEMPLATE = (projectDescription: string) => `
You are an expert project manager and task breakdown specialist. Based on the given project or goal description, create a comprehensive list of actionable tasks.

Project/Goal: "${projectDescription}"

Please create a well-structured task breakdown that includes:

1. **Project Overview**: Brief summary of what needs to be accomplished
2. **Task List**: A comprehensive list of specific, actionable tasks. for small projects, create 3-5 tasks. for large projects, create at most 10 tasks.


Format your response as follows:

## Project Overview
[Brief description of the project and its main objectives]

## Task Breakdown

1. **Task Title 1**
   - Description of what this task involves
   - Key deliverables or outcomes

2. **Task Title 2**
   - Description of what this task involves
   - Key deliverables or outcomes

[Continue for all tasks...]

## Next Steps
Would you like me to create an interactive canvas to manage these tasks and assign specialized agents to work on them?

Guidelines:
- Make each task specific and actionable
- Focus on logical task progression and dependencies
- Be realistic about scope and complexity
- Ensure tasks cover all aspects of the project
- Write clear, concise descriptions
- Avoid generic or vague tasks
`;

export const planTasks = ({ session, dataStream }: PlanTasksProps) =>
  tool({
    description: 'Create a detailed task breakdown for a project or goal. This generates a text-based list of tasks and asks if the user wants to create a visual canvas.',
    inputSchema: z.object({
      projectDescription: z.string().describe('The project, goal, or plan that needs to be broken down into tasks'),
    }),
    execute: async ({ projectDescription }) => {
      const taskPlanningPrompt = TASK_PLANNING_PROMPT_TEMPLATE(projectDescription);

      const { fullStream } = streamText({
        model: myProvider.languageModel('chat-model'),
        system: 'You are a project management expert. Create clear, actionable task breakdowns for any project or goal.',
        experimental_transform: smoothStream({ chunking: 'word' }),
        prompt: taskPlanningPrompt,
      });

      let responseText = '';

      for await (const delta of fullStream) {
        const { type } = delta;

        if (type === 'text') {
          const { text } = delta;
          responseText += text;
          
          // Stream the response as it's being generated
          dataStream.write({
            type: 'data-textDelta',
            data: text,
            transient: true,
          });
        }
      }

      return {
        projectDescription,
        taskBreakdown: responseText,
        message: 'Task breakdown has been generated. You can review the tasks and let me know if you\'d like to create a visual canvas for managing them.',
      };
    },
  }); 