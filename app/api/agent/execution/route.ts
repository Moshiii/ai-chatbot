import { auth } from '@/app/(auth)/auth';
import { ChatSDKError } from '@/lib/errors';
import { a2a } from '@/lib/ai/a2a-provider';
import { createDataStreamResponse } from 'ai';

export const maxDuration = 60;

interface AgentExecutionRequest {
  taskId: string;
  executionMode?: 'parallel' | 'sequential';
}

/**
 * Agent Execution API
 * Handles business logic (payment, validation) and routes to Python agent
 * The Python agent maintains task state and executes jobs
 */
export async function POST(request: Request) {
  console.log('[Agent Execution API] Received execution request');
  
  try {
    // 1. Authentication
    const session = await auth();
    
    if (!session?.user) {
      console.log('[Agent Execution API] Unauthorized - no session');
      return new ChatSDKError('unauthorized:auth').toResponse();
    }

    // 2. Parse request
    const body: AgentExecutionRequest = await request.json();
    const { taskId, executionMode = 'parallel' } = body;
    console.log(`[Agent Execution API] Task: ${taskId}, Mode: ${executionMode}, User: ${session.user.id}`);

    // 3. Validate required fields
    if (!taskId) {
      console.log('[Agent Execution API] Missing taskId');
      return new ChatSDKError('bad_request:api', 'Task ID is required').toResponse();
    }

    // 4. Business Logic - Payment Processing (placeholder)
    // TODO: Implement actual payment processing
    const paymentRequired = await checkPaymentRequired(taskId, session.user.id);
    if (paymentRequired) {
      console.log('[Agent Execution API] Payment required for task execution');
      // In production, this would:
      // - Calculate cost based on agents/jobs
      // - Process payment through payment provider
      // - Update user credits/balance
      // - Record transaction
      
      // For now, just log and continue
      console.log('[Agent Execution API] Payment processing placeholder - would charge user');
    }

    // 5. Rate Limiting (placeholder)
    // TODO: Implement rate limiting per user
    const rateLimitExceeded = await checkRateLimit(session.user.id);
    if (rateLimitExceeded) {
      console.log('[Agent Execution API] Rate limit exceeded');
      return new ChatSDKError('bad_request:api', 'Rate limit exceeded. Please try again later.').toResponse();
    }

    // 6. Check A2A agent configuration
    const a2aAgentUrl = process.env.A2A_AGENT_URL;
    const enableA2A = process.env.ENABLE_A2A === 'true';
    
    if (!enableA2A || !a2aAgentUrl) {
      console.log('[Agent Execution API] A2A not enabled or URL not configured');
      return new Response(JSON.stringify({
        error: 'Agent execution not available',
        message: 'Please set ENABLE_A2A=true and A2A_AGENT_URL in environment.',
        taskId,
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`[Agent Execution API] Using A2A agent at: ${a2aAgentUrl}`);

    // 7. Create A2A provider with streaming support
    const provider = a2a(a2aAgentUrl, {
      contextId: taskId, // Use taskId as context for grouping
      toolcallSupport: true, // Enable toolcall conversion
      taskMode: true,
      maxRetries: 2,
      timeout: 60000,
    });

    // 8. Create execution request for Python agent
    const executionMessage = {
      type: 'execute_jobs',
      taskId, // Python agent will look up stored task data
      executionMode,
      userId: session.user.id,
      timestamp: new Date().toISOString(),
    };

    console.log('[Agent Execution API] Sending to Python Task Agent:', executionMessage);
    
    // 9. Create a data stream for real-time updates
    // This creates a proper SSE stream that the canvas can consume
    return createDataStreamResponse({
      execute: async (dataStream) => {
        console.log('[Agent Execution API] Starting streaming execution');
        
        try {
          // Send initial status
          dataStream.writeData({
            type: 'execution-started',
            taskId,
            message: 'Starting agent execution'
          });

          // Execute through Python agent
          const result = await provider.doStream({
            inputFormat: 'messages',
            mode: { type: 'regular' },
            prompt: [
              {
                role: 'user' as const,
                content: JSON.stringify(executionMessage),
              },
            ],
          });

          // Process the stream and forward relevant events
          const reader = result.stream.getReader();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // Check if this is a tool call result
            if (value && typeof value === 'object') {
              if (value.type === 'tool-call' && value.toolName === 'updateTask') {
                // Forward updateTask data to canvas
                const toolArgs = JSON.parse(value.input || '{}');
                if (toolArgs.jobResponse) {
                  dataStream.writeData({
                    type: 'job-update',
                    data: toolArgs.jobResponse
                  });
                } else if (toolArgs.summary) {
                  dataStream.writeData({
                    type: 'summary-update',
                    data: toolArgs.summary
                  });
                }
              }
            }
          }

          // Send completion status
          dataStream.writeData({
            type: 'execution-completed',
            taskId,
            message: 'Agent execution completed'
          });
          
          console.log('[Agent Execution API] Streaming execution completed');
        } catch (error: any) {
          console.error('[Agent Execution API] Streaming error:', error);
          
          dataStream.writeData({
            type: 'execution-error',
            error: error.message || 'Execution failed',
            taskId
          });
        }
      },
      onError: (error) => {
        console.error('[Agent Execution API] Stream error:', error);
        return JSON.stringify({
          error: 'Stream error',
          message: error.message
        });
      }
    });
    
  } catch (error) {
    console.error('[Agent Execution API] Error:', error);
    
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    
    return new ChatSDKError('bad_request:api', 'Failed to execute agents').toResponse();
  }
}

// Helper functions (placeholders for business logic)

async function checkPaymentRequired(taskId: string, userId: string): Promise<boolean> {
  // TODO: Implement actual payment logic
  // Check if user has credits, subscription, etc.
  // Calculate cost based on task complexity
  return false; // For now, no payment required
}

async function checkRateLimit(userId: string): Promise<boolean> {
  // TODO: Implement rate limiting
  // Track requests per user per time period
  // Could use Redis or in-memory cache
  return false; // For now, no rate limiting
}