import { tool, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import type { ChatMessage } from '@/lib/types';
import type { Session } from 'next-auth';

interface PlanTasksProps {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

/**
 * Plan tasks tool - Agent decides when to use this for breaking down projects
 * The actual task planning logic is handled by the Python agent
 */
export const planTasks = ({ session, dataStream }: PlanTasksProps) =>
  tool({
    description: 'Plan and break down a project into tasks. The agent uses this when it detects a need for project planning.',
    inputSchema: z.object({
      projectDescription: z.string().describe('The project or goal to plan'),
      tasks: z.array(z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        priority: z.enum(['high', 'medium', 'low']).optional(),
        dependencies: z.array(z.string()).optional(),
      })).describe('Task breakdown from Python agent'),
    }),
    execute: async ({ projectDescription, tasks }) => {
      // Stream the task breakdown
      dataStream.write({
        type: 'data-textDelta',
        data: `## Project: ${projectDescription}\n\n`,
        transient: true,
      });

      // Stream each task
      for (const [index, task] of tasks.entries()) {
        const taskText = `${index + 1}. **${task.title}**\n   ${task.description}\n\n`;
        dataStream.write({
          type: 'data-textDelta',
          data: taskText,
          transient: true,
        });
      }

      return {
        projectDescription,
        taskCount: tasks.length,
        message: `Planned ${tasks.length} tasks for the project. The agent will coordinate execution.`,
      };
    },
  }); 