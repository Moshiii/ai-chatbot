import { tool, type UIMessageStreamWriter } from 'ai';
import type { Session } from 'next-auth';
import { z } from 'zod';
import type { ChatMessage } from '@/lib/types';

interface UpdateTaskProps {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
}

export const updateTask = ({ session, dataStream }: UpdateTaskProps) =>
  tool({
    description: 'Update task with job execution results or summary',
    inputSchema: z.object({
      jobResponse: z.object({
        jobId: z.string(),
        agentId: z.string(),
        agentName: z.string(),
        status: z.enum(['in-progress', 'completed', 'failed']),
        content: z.string(),
        timestamp: z.string(),
      }).optional(),
      summary: z.object({
        id: z.string(),
        content: z.string(),
        timestamp: z.string(),
      }).optional(),
    }),
    execute: async (args) => {
      // Stream the update to the canvas
      if (args.jobResponse) {
        console.log(`[updateTask] Job response: ${args.jobResponse.jobId} - ${args.jobResponse.status}`);
        
        // Send job response update to canvas
        dataStream.write({
          type: 'data-textDelta',
          data: JSON.stringify({ jobResponse: args.jobResponse }),
        });
        
        return {
          success: true,
          message: `Job ${args.jobResponse.jobId} status updated to ${args.jobResponse.status}`,
        };
      }
      
      if (args.summary) {
        console.log('[updateTask] Summary update');
        
        // Send summary to canvas
        dataStream.write({
          type: 'data-textDelta',
          data: JSON.stringify({ summary: args.summary }),
        });
        
        return {
          success: true,
          message: 'Summary updated',
        };
      }
      
      return {
        success: false,
        message: 'No update data provided',
      };
    },
  });