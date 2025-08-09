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
    description: 'Create an interactive task management canvas with AI-generated task breakdown. Use this when the user wants to create a visual canvas for project planning.',
    inputSchema: z.object({
      title: z.string().describe('Title/description of the project or goal to break down into tasks'),
    }),
    execute: async ({ title }) => {
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

      // Use the proper document creation system
      await documentHandler.onCreateDocument({
        id,
        title,
        dataStream,
        session,
      });

      dataStream.write({ type: 'data-finish', data: null, transient: true });

      return {
        id,
        title,
        kind: 'canvas',
        content: 'A canvas document was created and is now visible to the user.',
        message: `Canvas "${title}" has been created with AI-generated task breakdown. You can click on the canvas document widget to open the interactive task management interface.`,
      };
    },
  }); 