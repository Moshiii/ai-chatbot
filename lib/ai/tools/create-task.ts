import { tool, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import type { Session } from 'next-auth';
import type { ChatMessage } from '@/lib/types';
import { documentHandlersByArtifactKind } from '@/lib/artifacts/server';
import { generateTaskIds } from '@/lib/id-management';

interface CreateTaskProps {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

function initializeDocumentStream(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  id: string,
  title: string,
  kind: 'canvas',
) {
  dataStream.write({ type: 'data-kind', data: kind, transient: true });
  dataStream.write({ type: 'data-id', data: id, transient: true });
  dataStream.write({ type: 'data-title', data: title, transient: true });
  dataStream.write({ type: 'data-clear', data: null, transient: true });
}

export const createTask = ({ session, dataStream }: CreateTaskProps) =>
  tool({
    description:
      'Create a task by decomposing a project into individual jobs with assigned agents.',
    inputSchema: z.object({
      title: z.string().describe('Title of the task/project'),
      taskId: z.string().describe('Unique identifier for the task'),
      jobs: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            status: z.enum(['pending', 'in-progress', 'completed']),
            assignedAgent: z
              .object({
                id: z.string(),
                name: z.string(),
                description: z.string(),
                capabilities: z.array(z.string()),
                pricingUsdt: z.number().optional(),
                walletAddress: z.string().optional(),
              })
              .optional(),
          }),
        )
        .describe('Jobs that make up this task'),
    }),
    execute: async ({ title, taskId, jobs }) => {
      try {
        // Generate proper IDs using the new ID management system
        const ids = generateTaskIds(title, taskId);
        console.log('[createTask] Creating task:', {
          title,
          documentId: ids.document.databaseId,
          taskReferenceId: ids.task.referenceId,
          requestedTaskId: taskId,
          jobCount: jobs.length,
        });

        if (!jobs || jobs.length === 0) {
          throw new Error('Jobs array is required and cannot be empty');
        }

        // Initialize document stream for canvas
        initializeDocumentStream(
          dataStream,
          ids.document.databaseId,
          title,
          'canvas',
        );

        // Find the canvas document handler
        const documentHandler = documentHandlersByArtifactKind.find(
          (handler) => handler.kind === 'canvas',
        );

        if (!documentHandler) {
          throw new Error('No document handler found for canvas kind');
        }


        // Create the canvas document first
        console.log('[createTask] Creating canvas document...');
        await documentHandler.onCreateDocument({
          id: ids.document.databaseId,
          title,
          dataStream,
          session,
        });

        // Small delay to ensure canvas is ready
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Stream jobs to the canvas UI with proper task reference
        console.log('[createTask] Starting to stream', jobs.length, 'jobs...');
        for (const [index, job] of jobs.entries()) {
          const jobData = {
            newJob: job,
            taskId: ids.task.referenceId || ids.task.databaseId, // Use reference ID for task coordination
          };
          console.log(
            `[createTask] Streaming job ${index + 1}/${jobs.length}:`,
            job.title,
            'with taskId:',
            ids.task.referenceId || ids.task.databaseId,
          );
          try {
            dataStream.write({
              type: 'data-textDelta',
              data: JSON.stringify(jobData),
              transient: true,
            });

            // Small delay between jobs to ensure proper streaming
            if (index < jobs.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          } catch (error) {
            console.error('[createTask] Error streaming job:', error);
          }
        }

        // Send completion confirmation to ensure all jobs are processed

        dataStream.write({
          type: 'data-textDelta',
          data: JSON.stringify({
            type: 'jobs-completed',
            taskId: ids.task.referenceId || ids.task.databaseId,
            totalJobs: jobs.length,
          }),
          transient: true,
        });

        dataStream.write({ type: 'data-finish', data: null, transient: true });

        return {
          id: ids.document.databaseId,
          title,
          kind: 'canvas',
          taskId: ids.task.referenceId || ids.task.databaseId,
          documentId: ids.document.databaseId,
          taskReference: ids.task.referenceId,
          jobCount: jobs.length,
          message: `Task "${title}" created with ${jobs.length} jobs. Ready for agent execution.`,
        };
      } catch (error) {
        console.error('[createTask] Error creating task:', error);
        throw new Error(
          `Failed to create task: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    },
  });
