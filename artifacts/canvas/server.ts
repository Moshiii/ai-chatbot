import { createDocumentHandler } from '@/lib/artifacts/server';
import type { CreateDocumentCallbackProps, UpdateDocumentCallbackProps } from '@/lib/artifacts/server';

export const canvasDocumentHandler = createDocumentHandler({
  kind: 'canvas',
  onCreateDocument: async ({ id, title, dataStream }: CreateDocumentCallbackProps) => {
    // The Python agent will provide the task breakdown with pre-assigned agents
    // This function now just initializes the canvas and waits for data from Python
    
    console.log(`Creating canvas: ${title}`);
    
    // Initialize empty canvas structure
    const initialData = {
      taskId: null, // Will be set when task is created
      tasks: [],
      agents: [],
      responses: [],
      summary: null,
    };
    
    // Signal that canvas is ready for data
    dataStream.write({
      type: 'data-textDelta',
      data: JSON.stringify({ status: 'ready', canvasId: id }, null, 2),
      transient: true,
    });
    
    return JSON.stringify(initialData, null, 2);
  },
  onUpdateDocument: async ({ document, description, dataStream }: UpdateDocumentCallbackProps) => {
    // Updates will be handled by Python agent
    const existingData = document.content ? JSON.parse(document.content) : { 
      taskId: null,
      tasks: [], 
      agents: [], 
      responses: [], 
      summary: null 
    };
    
    // Just return existing data - Python agent handles all updates
    return JSON.stringify(existingData, null, 2);
  },
}); 