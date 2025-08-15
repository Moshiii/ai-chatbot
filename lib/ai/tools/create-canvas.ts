import { generateUUID } from '@/lib/utils';
import { tool, type UIMessageStreamWriter } from 'ai';
import { z } from 'zod';
import type { Session } from 'next-auth';
import type { ChatMessage } from '@/lib/types';
import { documentHandlersByArtifactKind } from '@/lib/artifacts/server';

interface CreateCanvasProps {
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

export const createCanvas = ({ session, dataStream }: CreateCanvasProps) =>
  tool({
    description: 'Create an interactive task management canvas. The agent decides when to create this for planning and task coordination.',
    inputSchema: z.object({
      title: z.string().describe('Title/description of the canvas'),
      tasks: z.array(z.object({
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
      })).optional().describe('Pre-planned tasks with assigned agents from Python agent'),
    }),
    execute: async ({ title, tasks = [] }) => {
      const id = generateUUID();

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

      // If tasks are provided, stream them to the canvas
      if (tasks && tasks.length > 0) {
        for (const task of tasks) {
          dataStream.write({
            type: 'data-textDelta',
            data: JSON.stringify({ newTask: task }, null, 2),
            transient: true,
          });
          
          // Small delay between tasks for visual effect
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      dataStream.write({ type: 'data-finish', data: null, transient: true });

      return {
        id,
        title,
        kind: 'canvas',
        content: 'A canvas document was created and is now visible to the user.',
        message: `Canvas "${title}" has been created. The interactive task management interface is now available.`,
      };
    },
  }); 