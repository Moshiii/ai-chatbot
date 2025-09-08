import { requireCurrentAppUser } from '@/lib/stack-auth';
import { ChatSDKError } from '@/lib/errors';
import { a2a } from '@/lib/ai/a2a-provider';
import { createUIMessageStream, JsonToSseTransformStream } from 'ai';
import type { UIMessage } from 'ai';

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
    const user = await requireCurrentAppUser();

    if (!user) {
      console.log('[Agent Execution API] Unauthorized - no session');
      return new ChatSDKError('unauthorized:auth').toResponse();
    }

    // 2. Parse request
    const body: AgentExecutionRequest = await request.json();
    const { taskId, executionMode = 'parallel' } = body;
    console.log(
      `[Agent Execution API] Task: ${taskId}, Mode: ${executionMode}, User: ${user.id}`,
    );

    // 3. Validate required fields
    if (!taskId) {
      console.log('[Agent Execution API] Missing taskId');
      return new ChatSDKError(
        'bad_request:api',
        'Task ID is required',
      ).toResponse();
    }

    // 4. Business Logic - Payment Processing (placeholder)
    // TODO: Implement actual payment processing
    const paymentRequired = await checkPaymentRequired(taskId, user.id);
    if (paymentRequired) {
      console.log('[Agent Execution API] Payment required for task execution');
      // In production, this would:
      // - Calculate cost based on agents/jobs
      // - Process payment through payment provider
      // - Update user credits/balance
      // - Record transaction

      // For now, just log and continue
      console.log(
        '[Agent Execution API] Payment processing placeholder - would charge user',
      );
    }

    // 5. Rate Limiting (placeholder)
    // TODO: Implement rate limiting per user
    const rateLimitExceeded = await checkRateLimit(user.id);
    if (rateLimitExceeded) {
      console.log('[Agent Execution API] Rate limit exceeded');
      return new ChatSDKError(
        'bad_request:api',
        'Rate limit exceeded. Please try again later.',
      ).toResponse();
    }

    // 6. Check A2A agent configuration
    const a2aAgentUrl = process.env.A2A_AGENT_URL;
    const enableA2A = process.env.ENABLE_A2A === 'true';

    if (!enableA2A || !a2aAgentUrl) {
      console.log(
        '[Agent Execution API] A2A not enabled or URL not configured',
      );
      return new Response(
        JSON.stringify({
          error: 'Agent execution not available',
          message:
            'Please set ENABLE_A2A=true and A2A_AGENT_URL in environment.',
          taskId,
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      );
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
      userId: user.id,
      timestamp: new Date().toISOString(),
    };

    console.log(
      '[Agent Execution API] Sending to Python Task Agent:',
      executionMessage,
    );

    // 9. Create a data stream for real-time updates using AI SDK helper
    const stream = createUIMessageStream<UIMessage>({
      execute: ({ writer }) => {
        (async () => {
          console.log('[Agent Execution API] Starting streaming execution');
          try {
            // Send initial status as text delta
            writer.write({
              type: 'data-textDelta',
              data: JSON.stringify({
                type: 'execution-started',
                taskId,
                message: 'Starting agent execution',
              }),
            });

            // Execute through Python agent
            const result = await provider.doStream({
              prompt: [
                {
                  role: 'user' as const,
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify(executionMessage),
                    },
                  ],
                },
              ],
            });

            // Process the stream and forward relevant events
            const reader = result.stream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && typeof value === 'object') {
                if (
                  value.type === 'tool-call' &&
                  value.toolName === 'updateTask'
                ) {
                  const toolArgs = JSON.parse((value as any).input || '{}');
                  if (toolArgs.jobResponse) {
                    // Forward job response update with standardized event type
                    writer.write({
                      type: 'data-textDelta',
                      data: JSON.stringify({
                        type: 'job-update',
                        data: toolArgs.jobResponse,
                      }),
                    });
                  } else if (toolArgs.summary) {
                    // Forward summary update with standardized event type
                    writer.write({
                      type: 'data-textDelta',
                      data: JSON.stringify({
                        type: 'summary-update',
                        data: toolArgs.summary,
                      }),
                    });
                  }
                }
              }
            }

            // Send completion status
            writer.write({
              type: 'data-textDelta',
              data: JSON.stringify({
                type: 'execution-completed',
                taskId,
                message: 'Agent execution completed',
              }),
            });
            console.log('[Agent Execution API] Streaming execution completed');
          } catch (error: unknown) {
            console.error('[Agent Execution API] Streaming error:', error);
            writer.write({
              type: 'data-textDelta',
              data: JSON.stringify({
                type: 'execution-error',
                error: (error as Error)?.message || 'Execution failed',
                taskId,
              }),
            });
          }
        })();
      },
    });

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    console.error('[Agent Execution API] Error:', error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      'bad_request:api',
      'Failed to execute agents',
    ).toResponse();
  }
}

// Helper functions (placeholders for business logic)

async function checkPaymentRequired(
  taskId: string,
  userId: string,
): Promise<boolean> {
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
