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
    console.log(
      `[Canvas Handler] 🚀 onCreateDocument CALLED: ${title} with ID: ${id}`,
    );
    console.log(
      `[Canvas Handler] 📋 Call timestamp: ${new Date().toISOString()}`,
    );
    console.log(`[Canvas Handler] 📦 Params received:`, {
      id,
      title,
      hasDataStream: !!dataStream,
    });

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
      `[Canvas Handler] ✅ Canvas ${id} initialized with empty structure`,
    );

    // ✅ CRITICAL FIX: Return document ID as content for Canvas artifact client
    // The Canvas client expects document ID in content to fetch document data
    const returnValue = id;
    console.log(
      `[Canvas Handler] 🎯 RETURNING document ID as artifact content: "${returnValue}"`,
    );
    console.log(
      `[Canvas Handler] 🎯 Return value type: ${typeof returnValue}, length: ${returnValue.length}`,
    );
    return returnValue;
  },
  onUpdateDocument: async ({
    document,
    description,
    dataStream,
  }: UpdateDocumentCallbackProps) => {
    console.log(`[Canvas Handler] 📝 Updating canvas artifact: ${document.id}`);

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

    // ✅ CRITICAL FIX: Return document ID as content for Canvas artifact client
    // The Canvas client expects document ID in content to fetch document data
    console.log(
      `[Canvas Handler] 📤 Returning document ID as artifact content: ${document.id}`,
    );
    return document.id;
  },
});
