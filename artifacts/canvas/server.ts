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
    session,
  }: CreateDocumentCallbackProps) => {
    console.log(`[Canvas Handler] 🚀 Creating Canvas: ${title} (${id})`);

    // Check if task data is available from the A2A tool
    const canvasData = (global as any).canvasTaskData;

    if (canvasData?.tasks?.length > 0) {
      console.log(`[Canvas Handler] ✅ Found task data, streaming to Canvas:`, {
        taskCount: canvasData.tasks.length,
        documentId: canvasData.documentId,
      });

      const canvasContent = JSON.stringify(canvasData);

      // Stream the Canvas data with task information
      dataStream.write({
        type: 'data-textDelta',
        data: canvasContent,
        transient: false, // Content should persist
      });

      // Clear the global data after use
      (global as any).canvasTaskData = null;

      return canvasContent;
    } else {
      console.log(
        `[Canvas Handler] ⚠️ No task data found, creating empty Canvas`,
      );

      const placeholder = JSON.stringify({
        tasks: [],
        documentId: id,
        title: title,
        status: 'waiting-for-tasks',
      });

      dataStream.write({
        type: 'data-textDelta',
        data: placeholder,
        transient: true,
      });

      return placeholder;
    }
  },

  onUpdateDocument: async ({ document }: UpdateDocumentCallbackProps) => {
    console.log(
      `[Canvas Handler] 📖 Loading existing Canvas: ${document.title} (${document.id})`,
    );

    // Return existing content for reopened Canvas documents
    return (
      document.content ||
      JSON.stringify({
        tasks: [],
        documentId: document.id,
        title: document.title,
      })
    );
  },
});
