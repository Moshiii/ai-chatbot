import { generateUUID } from '@/lib/utils';
import { tool, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import type { Session } from 'next-auth';
import type { ChatMessage } from '@/lib/types';
import { documentHandlersByArtifactKind } from '@/lib/artifacts/server';

interface CreateTaskProps {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

function initializeDocumentStream(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  id: string,
  title: string,
  kind: 'canvas'
) {
  dataStream.write({ type: 'data-kind', data: kind, transient: true });
  dataStream.write({ type: 'data-id', data: id, transient: true });
  dataStream.write({ type: 'data-title', data: title, transient: true });
  dataStream.write({ type: 'data-clear', data: null, transient: true });
}

export const createTask = ({ session, dataStream }: CreateTaskProps) =>
  tool({
    description: 'Create a task by decomposing a project into individual jobs with assigned agents.',
    inputSchema: z.object({
      title: z.string().describe('Title of the task/project'),
      taskId: z.string().describe('Unique identifier for the task'),
      jobs: z.array(z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        status: z.enum(['pending', 'in-progress', 'completed']),
        assignedAgent: z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          capabilities: z.array(z.string()),
          pricingUsdt: z.number().optional(),
          walletAddress: z.string().optional(),
        }).optional(),
      })).describe('Jobs that make up this task'),
    }),
    execute: async ({ title, taskId, jobs }) => {
      const id = taskId || generateUUID();
      console.log('[createTask] Creating task with id:', id, 'title:', title, 'jobs:', jobs.length);

      // Initialize document stream
      initializeDocumentStream(dataStream, id, title, 'canvas');

      // Find the canvas document handler
      const documentHandler = documentHandlersByArtifactKind.find(
        (handler) => handler.kind === 'canvas',
      );

      if (!documentHandler) {
        throw new Error('No document handler found for canvas kind');
      }

      // Create the canvas document
      await documentHandler.onCreateDocument({
        id,
        title,
        dataStream,
        session,
      });

      // Stream individual jobs for real-time UI updates
      for (const job of jobs) {
        const jobData = { 
          newJob: job,
          taskId: id  // Include taskId with each job
        };
        console.log('[createTask] Streaming job with taskId:', id, 'job:', job.title);
        dataStream.write({
          type: 'data-textDelta',
          data: JSON.stringify(jobData),
          transient: true,
        });
      }
      
      // Send completion confirmation to ensure all jobs are processed
      dataStream.write({
        type: 'data-textDelta',
        data: JSON.stringify({ 
          type: 'jobs-completed', 
          taskId: id, 
          totalJobs: jobs.length 
        }),
        transient: true,
      });

      dataStream.write({ type: 'data-finish', data: null, transient: true });

      return {
        id,
        title,
        kind: 'canvas',
        taskId: id,
        jobCount: jobs.length,
        message: `Task "${title}" created with ${jobs.length} jobs. Ready for agent execution.`,
      };
    },
  }); 