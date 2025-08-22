import { createDocumentHandler } from '@/lib/artifacts/server';
import type {
  CreateDocumentCallbackProps,
  UpdateDocumentCallbackProps,
} from '@/lib/artifacts/server';

export const canvasDocumentHandler = createDocumentHandler({
  kind: 'canvas',
  onCreateDocument: async ({
    id,
    title,
    dataStream,
  }: CreateDocumentCallbackProps) => {
    console.log(`[Canvas Handler] Creating canvas: ${title} with ID: ${id}`);

    // Initialize empty canvas structure
    const initialData = {
      taskId: id, // Use the document ID (UUID) as the initial task ID
      tasks: [],
      agents: [],
      responses: [],
      summary: null,
    };

    // Signal that canvas is ready and provide helpful message
    dataStream.write({
      type: 'data-textDelta',
      data: JSON.stringify({
        status: 'canvas-ready',
        canvasId: id,
        message: `Canvas "${title}" created. Ready for task data.`,
      }),
      transient: true,
    });

    console.log(
      `[Canvas Handler] Canvas ${id} initialized with empty structure`,
    );
    return JSON.stringify(initialData, null, 2);
  },
  onUpdateDocument: async ({
    document,
    description,
    dataStream,
  }: UpdateDocumentCallbackProps) => {
    // Updates will be handled by Python agent
    const existingData = document.content
      ? JSON.parse(document.content)
      : {
          taskId: null,
          tasks: [],
          agents: [],
          responses: [],
          summary: null,
        };

    // Just return existing data - Python agent handles all updates
    return JSON.stringify(existingData, null, 2);
  },
});
