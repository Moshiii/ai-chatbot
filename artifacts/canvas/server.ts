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
    // Load existing canvas data when document is opened
    if (document.content) {
      try {
        const existingData = JSON.parse(document.content);

        // If we have saved data, stream it to the client to load into metadata
        if (existingData.tasks && existingData.tasks.length > 0) {
          console.log('[Canvas Handler] Loading saved canvas data:', {
            taskId: existingData.taskId,
            taskCount: existingData.tasks.length,
            agentCount: existingData.agents?.length || 0,
            responseCount: existingData.responses?.length || 0,
            hasSummary: !!existingData.summary,
          });

          // Stream the saved data to the client
          dataStream.write({
            type: 'data-textDelta',
            data: JSON.stringify({
              type: 'load-saved-data',
              ...existingData,
            }),
            transient: true,
          });
        }
      } catch (error) {
        console.error(
          '[Canvas Handler] Failed to parse saved canvas data:',
          error,
        );
      }
    }

    // Return existing data - Python agent handles all updates
    const existingData = document.content
      ? JSON.parse(document.content)
      : {
          taskId: null,
          tasks: [],
          agents: [],
          responses: [],
          summary: null,
        };

    return JSON.stringify(existingData, null, 2);
  },
});
