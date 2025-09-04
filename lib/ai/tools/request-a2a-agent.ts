import { z } from 'zod';
import { tool } from 'ai';
import { A2AClient } from '@a2a-js/sdk/client';
import type { Message as A2AMessage, Task } from '@a2a-js/sdk';
import { contextUtils } from '@/lib/context-management';

import {
  saveDocument as saveDocumentQuery,
  createTask as createTaskQuery,
  updateDocumentTaskIds,
} from '@/lib/db/queries';
import type { taskStatusEnum } from '@/lib/db/schema';
import { generateUUID } from '@/lib/utils';

// Helper function to convert A2A message parts (kind-based) to text content
function convertA2APartsToText(
  parts?: Array<{ kind: string; text?: string }>,
): string {
  if (!parts || !Array.isArray(parts)) return '';

  return parts
    .filter((part) => part.kind === 'text' && part.text)
    .map((part) => part.text)
    .join('\n');
}

// Remove old schema - now handled inline in tool factory

// Create the tool factory function that provides session context
export const requestA2AAgent = ({
  session,
  dataStream,
}: { session: any; dataStream: any }) =>
  tool({
    description: `Send requests to external A2A agent for complex task planning and execution. 

Use this tool when the user needs:
- A2A agent to plan and execute tasks

Examples:
- Plan a three day trip to Japan with accommodation, transportation, and activities
- Research the best places to do bungy jumping in New Zealand
- What are the recipes to boost my metabolism

The tool will communicate with an external A2A-compliant agent that specializes in task planning and execution.`,

    inputSchema: z.object({
      userRequirements: z
        .string()
        .describe(
          'Detailed description of what the user wants accomplished, including context, constraints, and expected outcomes',
        ),
      urgency: z
        .enum(['low', 'medium', 'high'])
        .optional()
        .default('medium')
        .describe(
          'Priority level for task execution (optional, default: medium)',
        ),
      title: z
        .string()
        .optional()
        .default('Task Canvas')
        .describe('Title for the task canvas document'),
    }),

    execute: async ({
      userRequirements,
      urgency,
      title,
    }: {
      userRequirements: string;
      urgency?: 'low' | 'medium' | 'high';
      title?: string;
    }) => {
      try {
        if (!session?.user) {
          throw new Error('Authentication required');
        }

        // Generate context for A2A request - let framework handle chat association
        const contextId = generateUUID();

        // Communicate progress to UI through dataStream
        dataStream.write({
          type: 'data-kind',
          data: 'canvas',
          transient: true,
        });

        dataStream.write({
          type: 'data-title',
          data: title,
          transient: true,
        });

        console.log('[A2A Tool] Sending request to external A2A agent:', {
          contextId,
          urgency,
          hasDataStream: !!dataStream,
        });

        // Step 1: Send request to A2A agent first (before creating any documents)
        const agentUrl = process.env.A2A_AGENT_URL;
        if (!agentUrl) {
          throw new Error(
            'A2A_AGENT_URL environment variable is not configured',
          );
        }

        const webhookToken = contextUtils.generateWebhookToken();
        const client = new A2AClient(agentUrl);

        // A2A-compliant message using standard format from specification
        const a2aMessage: A2AMessage = {
          kind: 'message',
          messageId: generateUUID(),
          role: 'user',
          parts: [
            {
              kind: 'text',
              text: `${userRequirements}\n\nUrgency: ${urgency}\nContext: ${contextId}`,
            },
          ],
          contextId: contextId,
          metadata: {
            urgency,
            title,
          },
        };

        console.log('[A2A Tool] Sending request to external agent:', {
          agentUrl,
          contextId,
          urgency,
          hasWebhookToken: !!webhookToken,
          userRequirementsLength: userRequirements.length,
        });

        const response = await client.sendMessage({
          message: a2aMessage,
          configuration: {
            blocking: false,
            acceptedOutputModes: ['text/plain', 'application/json'],
            pushNotificationConfig: {
              url: `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhook/tasks`,
              token: webhookToken,
            },
          },
        });

        console.log('[A2A Tool] Received response from external agent:', {
          responseType: typeof response,
          hasResult: 'result' in response,
          resultKind: 'result' in response ? response.result?.kind : 'none',
          resultStructure:
            'result' in response ? Object.keys(response.result || {}) : [],
        });

        if ('error' in response) {
          console.error('[A2A Tool] A2A agent returned error:', response.error);
          throw new Error(`A2A agent error: ${response.error.message}`);
        }

        const result = response.result;

        // Debug: Log the actual structure of the result
        console.log(
          '[A2A Tool] Full result structure:',
          JSON.stringify(result, null, 2),
        );

        // Additional debug: Check if artifacts are present but empty
        if (result?.kind === 'task') {
          const task = result as Task;
          console.log('[A2A Tool] Task structure analysis:', {
            hasArtifacts: !!task.artifacts,
            artifactsLength: task.artifacts?.length || 0,
            hasHistory: !!task.history,
            historyLength: task.history?.length || 0,
            hasStatus: !!task.status,
            statusState: task.status?.state,
            hasStatusMessage: !!task.status?.message,
          });
        }

        // Step 2: Process A2A response and extract tasks
        let extractedTasks: any[] = [];

        if (result?.kind === 'task') {
          const task = result as Task;
          extractedTasks = extractTasksFromA2AResponse(
            task,
            webhookToken,
            urgency,
            title,
          );

          console.log('[A2A Tool] Extracted tasks from A2A Task response:', {
            taskCount: extractedTasks.length,
            taskIds: extractedTasks.map((t) => t.id),
          });

          // If no tasks found in Task structure, check the task history for agent response messages
          if (
            extractedTasks.length === 0 &&
            task.history &&
            Array.isArray(task.history)
          ) {
            console.log(
              '[A2A Tool] No tasks in Task structure, checking task history for agent messages',
            );
            for (const historyMessage of task.history) {
              if (historyMessage.role === 'agent' && historyMessage.parts) {
                console.log(
                  '[A2A Tool] Found agent message in history, extracting tasks',
                );
                const historyTasks = extractTasksFromMessageResponse(
                  historyMessage,
                  webhookToken,
                  urgency,
                  title,
                );
                extractedTasks.push(...historyTasks);
              }
            }

            console.log('[A2A Tool] Extracted tasks from Task history:', {
              taskCount: extractedTasks.length,
              taskIds: extractedTasks.map((t) => t.id),
            });
          }

          // If still no tasks, check the task status message for agent response
          if (extractedTasks.length === 0 && task.status?.message) {
            console.log(
              '[A2A Tool] No tasks in history, checking task status message',
            );
            const statusMessage = task.status.message as any;
            if (statusMessage.role === 'agent' && statusMessage.parts) {
              console.log(
                '[A2A Tool] Found agent message in status, extracting tasks',
              );
              const statusTasks = extractTasksFromMessageResponse(
                statusMessage,
                webhookToken,
                urgency,
                title,
              );
              extractedTasks.push(...statusTasks);

              console.log(
                '[A2A Tool] Extracted tasks from Task status message:',
                {
                  taskCount: extractedTasks.length,
                  taskIds: extractedTasks.map((t) => t.id),
                },
              );
            }
          }

          // If still no tasks, check if the A2A framework put the response in a different location
          if (extractedTasks.length === 0) {
            console.log(
              '[A2A Tool] No tasks found in standard locations, checking alternative locations',
            );

            // Check if there's any data in the task object that might contain task information
            const taskAsAny = task as any;

            // Check task status for artifacts (Python agent puts artifacts in status)
            if (task.status && typeof task.status === 'object') {
              const statusAsAny = task.status as any;
              if (
                statusAsAny.artifacts &&
                Array.isArray(statusAsAny.artifacts)
              ) {
                console.log(
                  `[A2A Tool] Found ${statusAsAny.artifacts.length} artifacts in task status`,
                );
                for (const artifact of statusAsAny.artifacts) {
                  if (artifact.parts && Array.isArray(artifact.parts)) {
                    for (const part of artifact.parts) {
                      if (
                        part.kind === 'data' &&
                        part.data?.type === 'task' &&
                        part.data?.task
                      ) {
                        const taskData = part.data.task;
                        const mappedTask = {
                          id: taskData.id || generateUUID(),
                          title: taskData.title || 'Unnamed Task',
                          description: taskData.description || '',
                          status:
                            mapA2AStatusToDbStatus(taskData.status) ||
                            'submitted',
                          contextId: task.contextId || generateUUID(),
                          webhookToken: webhookToken,
                          assignedAgent: taskData.assignedAgent,
                          priority: taskData.priority || urgency,
                          createdAt: taskData.createdAt
                            ? new Date(taskData.createdAt)
                            : new Date(),
                        };

                        console.log(
                          '[A2A Tool] Extracted task from status artifacts:',
                          {
                            originalId: taskData.id,
                            mappedId: mappedTask.id,
                            title: mappedTask.title,
                            status: mappedTask.status,
                          },
                        );
                        extractedTasks.push(mappedTask);
                      }
                    }
                  }
                }
              }
            }

            // Check for any properties that might contain the agent response
            if (extractedTasks.length === 0) {
              const possibleResponseKeys = [
                'response',
                'result',
                'data',
                'content',
                'output',
              ];
              for (const key of possibleResponseKeys) {
                if (taskAsAny[key] && typeof taskAsAny[key] === 'object') {
                  console.log(`[A2A Tool] Checking task.${key} for task data`);

                  if (
                    taskAsAny[key].parts &&
                    Array.isArray(taskAsAny[key].parts)
                  ) {
                    const alternativeTasks = extractTasksFromMessageResponse(
                      taskAsAny[key],
                      webhookToken,
                      urgency,
                      title,
                    );
                    if (alternativeTasks.length > 0) {
                      console.log(
                        `[A2A Tool] Found ${alternativeTasks.length} tasks in task.${key}`,
                      );
                      extractedTasks.push(...alternativeTasks);
                      break;
                    }
                  }
                }
              }
            }
          }
        } else if (result?.kind === 'message') {
          // Handle case where Python agent returns a Message with task data in parts
          console.log(
            '[A2A Tool] Processing Message response with potential task data',
          );
          const message = result as any;
          extractedTasks = extractTasksFromMessageResponse(
            message,
            webhookToken,
            urgency,
            title,
          );

          console.log('[A2A Tool] Extracted tasks from A2A Message response:', {
            taskCount: extractedTasks.length,
            taskIds: extractedTasks.map((t) => t.id),
          });
        }

        // Step 3: Only create canvas document if we have tasks
        if (extractedTasks.length === 0) {
          // If no tasks were extracted, check if this was a message response without tasks
          if (result?.kind === 'message') {
            // Convert A2A message parts (kind-based) to text
            const messageResult = result as any;
            const responseText =
              convertA2APartsToText(messageResult.parts) ||
              'No response content';

            // Communicate response through dataStream without creating documents
            dataStream.write({
              type: 'data-clear',
              data: null,
              transient: true,
            });

            return {
              content: responseText,
              message:
                'A2A agent processed the request but did not generate specific tasks.',
              contextId: contextId,
            };
          }

          throw new Error('A2A agent did not return any tasks');
        }

        if (result?.kind === 'task' || result?.kind === 'message') {
          console.log(
            '[A2A Tool] Creating canvas document after successful A2A response',
          );
          const documentId = generateUUID();

          const [canvasDocument] = await saveDocumentQuery({
            id: documentId,
            title: title || 'Task Canvas',
            kind: 'canvas',
            content: `# ${title || 'Task Canvas'}\n\nTasks generated from A2A agent (${extractedTasks.length} tasks)`,
            userId: session.user.id,
          });

          if (!canvasDocument) {
            throw new Error('Failed to create canvas document');
          }

          // Step 4: Create tasks in database
          const createdTasks = [];
          for (const taskData of extractedTasks) {
            try {
              const taskId = taskData.id || generateUUID();
              const [createdTask] = await createTaskQuery({
                id: taskId,
                contextId: contextId,
                status: taskData.status as (typeof taskStatusEnum)[number],
                statusMessage: taskData.description || taskData.title,
                result: {
                  title: taskData.title || 'Unnamed Task',
                  description: taskData.description || '',
                  priority: taskData.priority || urgency,
                  assignedAgent: taskData.assignedAgent,
                },
                webhookToken,
              });

              if (createdTask) {
                createdTasks.push(createdTask);
              }
            } catch (taskError) {
              console.error('[A2A Tool] Error creating task:', taskError);
            }
          }

          // Step 5: Link tasks to canvas document
          if (createdTasks.length > 0) {
            const taskIds = createdTasks.map((t) => t.id);
            await updateDocumentTaskIds({
              documentId: canvasDocument.id,
              taskIds,
            });

            console.log('[A2A Tool] Linked tasks to canvas:', {
              documentId: canvasDocument.id,
              taskIds,
            });
          }

          // Step 6: Communicate canvas information to UI via dataStream (AI SDK v5 pattern)
          dataStream.write({
            type: 'data-id',
            data: canvasDocument.id,
            transient: true,
          });

          dataStream.write({
            type: 'data-clear',
            data: null,
            transient: true,
          });

          // Write task information to dataStream for UI consumption
          for (const task of createdTasks) {
            const taskResult =
              task.result && typeof task.result === 'object'
                ? (task.result as any)
                : {};
            dataStream.write({
              type: 'data-task',
              data: {
                task: {
                  id: task.id,
                  contextId: task.contextId,
                  status: task.status,
                  title: taskResult.title || 'Task',
                  description: taskResult.description || '',
                },
              },
              transient: true,
            });
          }

          dataStream.write({
            type: 'data-finish',
            data: null,
            transient: true,
          });

          console.log(
            '[A2A Tool] Communicated canvas and task data via dataStream:',
            {
              documentId: canvasDocument.id,
              taskCount: createdTasks.length,
            },
          );

          return {
            id: canvasDocument.id,
            title: canvasDocument.title,
            kind: canvasDocument.kind,
            content: `Successfully created ${createdTasks.length} tasks and canvas document. Tasks are now being tracked in the canvas.`,
            taskCount: createdTasks.length,
            contextId: contextId,
          };
        }

        throw new Error('A2A agent returned an unexpected response format');
      } catch (error: any) {
        console.error('[A2A Tool] Error in integrated flow:', error);

        // Communicate error to UI
        dataStream.write({
          type: 'data-clear',
          data: null,
          transient: true,
        });

        return {
          content: `Failed to process A2A request: ${error.message}`,
          error: error.message,
        };
      }
    },
  });

/**
 * Extract task objects from A2A Message response
 */
function extractTasksFromMessageResponse(
  message: any,
  webhookToken: string,
  urgency?: string,
  title?: string,
) {
  const tasks: any[] = [];

  // Process message parts for structured task data
  if (message.parts && Array.isArray(message.parts)) {
    console.log('[A2A Tool] Processing message parts for task data:', {
      partsCount: message.parts.length,
      partTypes: message.parts.map((p: any) => p.kind),
    });

    for (const part of message.parts) {
      console.log('[A2A Tool] Processing part:', {
        kind: part.kind,
        hasData: 'data' in part,
        dataType: 'data' in part ? typeof part.data : 'none',
      });

      if (
        part.kind === 'data' &&
        'data' in part &&
        part.data &&
        typeof part.data === 'object'
      ) {
        const partData = part.data as any;
        console.log('[A2A Tool] Found data part:', {
          dataType: partData.type,
          hasTask: !!partData.task,
          taskKeys: partData.task ? Object.keys(partData.task) : [],
        });

        if (partData.type === 'task' && partData.task) {
          const taskData = partData.task;
          const mappedTask = {
            id: taskData.id || generateUUID(),
            title: taskData.title || 'Unnamed Task',
            description: taskData.description || '',
            status: mapA2AStatusToDbStatus(taskData.status) || 'submitted',
            contextId: message.contextId || generateUUID(),
            webhookToken: webhookToken,
            assignedAgent: taskData.assignedAgent,
            priority: taskData.priority || urgency,
            createdAt: taskData.createdAt
              ? new Date(taskData.createdAt)
              : new Date(),
          };

          console.log('[A2A Tool] Extracted task from Message part:', {
            originalId: taskData.id,
            mappedId: mappedTask.id,
            title: mappedTask.title,
            status: mappedTask.status,
          });
          tasks.push(mappedTask);
        }
      }
    }
  }

  return tasks;
}

/**
 * Extract task objects from A2A response following the A2A specification
 */
function extractTasksFromA2AResponse(
  task: Task,
  webhookToken: string,
  urgency?: string,
  title?: string,
) {
  const tasks: any[] = [];

  // First, check if this is actually a Message with parts (from Python agent)
  // The Python agent returns a Message but the A2A client might interpret it as a Task
  const taskAsAny = task as any;
  if (taskAsAny.parts && Array.isArray(taskAsAny.parts)) {
    console.log(
      '[A2A Tool] Processing task with parts (Message-like structure):',
      {
        partsCount: taskAsAny.parts.length,
        partTypes: taskAsAny.parts.map((p: any) => p.kind),
      },
    );

    for (const part of taskAsAny.parts) {
      console.log('[A2A Tool] Processing task part:', {
        kind: part.kind,
        hasData: 'data' in part,
        dataType: 'data' in part ? typeof part.data : 'none',
      });

      if (
        part.kind === 'data' &&
        'data' in part &&
        part.data &&
        typeof part.data === 'object'
      ) {
        const partData = part.data as any;
        console.log('[A2A Tool] Found task data part:', {
          dataType: partData.type,
          hasTask: !!partData.task,
          taskKeys: partData.task ? Object.keys(partData.task) : [],
        });

        if (partData.type === 'task' && partData.task) {
          const taskData = partData.task;
          const mappedTask = {
            id: taskData.id || generateUUID(),
            title: taskData.title || 'Unnamed Task',
            description: taskData.description || '',
            status: mapA2AStatusToDbStatus(taskData.status) || 'submitted',
            contextId: task.contextId || generateUUID(),
            webhookToken: webhookToken,
            assignedAgent: taskData.assignedAgent,
            priority: taskData.priority || urgency,
            createdAt: taskData.createdAt
              ? new Date(taskData.createdAt)
              : new Date(),
          };

          console.log('[A2A Tool] Extracted task from top-level A2A part:', {
            originalId: taskData.id,
            mappedId: mappedTask.id,
            title: mappedTask.title,
            status: mappedTask.status,
          });
          tasks.push(mappedTask);
        }
      }
    }
  }

  // Then, process artifacts to find task data parts following A2A specification
  // (This is for cases where tasks might be embedded in artifacts)
  if (task.artifacts && Array.isArray(task.artifacts)) {
    for (const artifact of task.artifacts) {
      if (artifact.parts && Array.isArray(artifact.parts)) {
        for (const part of artifact.parts) {
          // A2A specification: DataPart has kind='data' and data object
          if (
            part.kind === 'data' &&
            'data' in part &&
            part.data &&
            typeof part.data === 'object'
          ) {
            const partData = part.data as any;

            // Check for task data following the format from Python agent
            if (partData.type === 'task' && partData.task) {
              const taskData = partData.task;

              // Map A2A task format to database task format
              const mappedTask = {
                id: taskData.id || generateUUID(),
                title: taskData.title || 'Unnamed Task',
                description: taskData.description || '',
                status: mapA2AStatusToDbStatus(taskData.status) || 'submitted',
                contextId: task.contextId || generateUUID(),
                webhookToken: webhookToken,
                assignedAgent: taskData.assignedAgent,
                priority: taskData.priority || urgency,
                createdAt: taskData.createdAt
                  ? new Date(taskData.createdAt)
                  : new Date(),
              };

              console.log('[A2A Tool] Extracted task from A2A artifact:', {
                originalId: taskData.id,
                mappedId: mappedTask.id,
                title: mappedTask.title,
                status: mappedTask.status,
              });

              tasks.push(mappedTask);
            }
          }
        }
      }
    }
  }

  // As a last resort, if no structured tasks were found, try to extract from task status message
  // This will create a single generic task based on the status message
  if (tasks.length === 0 && task.status?.message) {
    const statusMessageText = convertA2APartsToText(task.status.message.parts);

    if (statusMessageText) {
      tasks.push({
        id: task.id || generateUUID(),
        title: title || 'A2A Generated Task',
        description: statusMessageText,
        status: mapA2AStatusToDbStatus(task.status.state) || 'submitted',
        contextId: task.contextId || generateUUID(),
        webhookToken: webhookToken,
        createdAt: new Date(),
      });
    }
  }

  return tasks;
}

/**
 * Map A2A task status to database task status
 */
function mapA2AStatusToDbStatus(
  a2aStatus?: string,
): (typeof taskStatusEnum)[number] | undefined {
  const statusMap: Record<string, (typeof taskStatusEnum)[number]> = {
    submitted: 'submitted',
    working: 'working',
    'input-required': 'input-required',
    completed: 'completed',
    canceled: 'canceled',
    cancelled: 'canceled', // Handle spelling variation
    failed: 'failed',
    rejected: 'rejected',
    'auth-required': 'auth-required',
    unknown: 'unknown',
  };

  return a2aStatus ? statusMap[a2aStatus] : undefined;
}
