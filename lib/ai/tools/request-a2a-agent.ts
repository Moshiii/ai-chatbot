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
              text: userRequirements,
            },
          ],
          contextId: contextId,
          metadata: {
            urgency,
            title,
          },
        };

        // Create canvas document ID for client-side management (passed to webhook later)
        const documentId = generateUUID();

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
            blocking: true, // Wait for agent message to include tasks in the result
            acceptedOutputModes: ['text/plain', 'application/json'],
            pushNotificationConfig: {
              url: `http://localhost:3000/api/webhook/tasks`,
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
          hasError: 'error' in response,
        });

        // Enhanced debugging: Log the complete response structure
        console.log(
          '[A2A Tool] Complete response structure:',
          JSON.stringify(response, null, 2),
        );

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
          console.log('[A2A Tool] Processing A2A Task response:', {
            hasArtifacts: !!task.artifacts,
            artifactsLength: task.artifacts?.length || 0,
            hasStatus: !!task.status,
            statusState: task.status?.state,
            taskId: task.id,
            contextId: task.contextId,
          });

          // Debug: Log artifacts structure in detail
          if (task.artifacts && task.artifacts.length > 0) {
            console.log('[A2A Tool] Artifacts structure:');
            task.artifacts.forEach((artifact, index) => {
              console.log(`[A2A Tool] Artifact ${index}:`, {
                artifactId: artifact.artifactId,
                partsCount: artifact.parts?.length || 0,
                partTypes: artifact.parts?.map((p) => p.kind) || [],
              });

              if (artifact.parts) {
                artifact.parts.forEach((part, partIndex) => {
                  console.log(
                    `[A2A Tool] Artifact ${index}, Part ${partIndex}:`,
                    {
                      kind: part.kind,
                      hasData: 'data' in part,
                      dataType:
                        'data' in part ? typeof (part as any).data : 'none',
                      dataStructure:
                        'data' in part && (part as any).data
                          ? Object.keys((part as any).data)
                          : [],
                    },
                  );
                });
              }
            });
          }

          extractedTasks = extractTasksFromA2AResponse(
            task,
            webhookToken,
            urgency,
            title,
          );

          console.log('[A2A Tool] Extracted tasks from A2A Task response:', {
            taskCount: extractedTasks.length,
            taskIds: extractedTasks.map((t) => t.id),
            taskTitles: extractedTasks.map((t) => t.title),
          });

          if (extractedTasks.length === 0) {
            console.log(
              '[A2A Tool] ⚠️ No tasks extracted from Task response - this indicates an issue',
            );
            console.log('[A2A Tool] Task debugging info:', {
              hasArtifacts: !!(result as Task).artifacts,
              artifactsLength: (result as Task).artifacts?.length || 0,
              hasHistory: !!(result as Task).history,
              historyLength: (result as Task).history?.length || 0,
              hasStatus: !!(result as Task).status,
            });
          }
        } else if (result?.kind === 'message') {
          // This path should ideally not be taken if Python agent sends TaskStatusUpdateEvent with artifacts
          console.log(
            '[A2A Tool] Processing Message response (fallback path) with potential task data',
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
        } else {
          console.log('[A2A Tool] ⚠️ Unknown result kind or no result:', {
            resultKind: (result as any)?.kind || 'undefined',
            hasResult: !!result,
            resultType: typeof result,
          });
        }

        // Step 3: Create canvas document
        console.log(
          '[A2A Tool] Creating canvas document for A2A task tracking',
        );

        const [canvasDocument] = await saveDocumentQuery({
          id: documentId,
          title: title || 'Task Canvas',
          kind: 'canvas',
          content: `# ${title || 'Task Canvas'}\n\nTasks are being generated by the A2A agent. This canvas will be updated with task details as they become available.`,
          userId: session.user.id,
        });

        if (!canvasDocument) {
          throw new Error('Failed to create canvas document');
        }

        // Communicate canvas information to UI via dataStream
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

        dataStream.write({
          type: 'data-id',
          data: canvasDocument.id,
          transient: true,
        });

        // If we have immediate tasks (from blocking response), process them
        if (extractedTasks.length > 0) {
          console.log(
            '[A2A Tool] Processing immediate tasks from A2A response',
          );

          // Create tasks in database
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

          // Link tasks to canvas document
          if (createdTasks.length > 0) {
            const taskIds = createdTasks.map((t) => t.id);
            await updateDocumentTaskIds({
              documentId: canvasDocument.id,
              taskIds,
            });

            console.log('[A2A Tool] Linked immediate tasks to canvas:', {
              documentId: canvasDocument.id,
              taskIds,
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
          }
        }

        dataStream.write({
          type: 'data-clear',
          data: null,
          transient: true,
        });

        return {
          id: canvasDocument.id,
          title: canvasDocument.title,
          kind: canvasDocument.kind,
          content:
            extractedTasks.length > 0
              ? `Successfully created ${extractedTasks.length} tasks and canvas document. Tasks are now being tracked in the canvas.`
              : `Canvas created for A2A task tracking. Tasks will be added after confirmation.`,
          taskCount: extractedTasks.length,
          contextId: contextId,
          webhookToken: webhookToken, // Include webhook token for debugging
        };
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

  // Prioritize artifacts from TaskStatusUpdateEvent
  if (task.artifacts && Array.isArray(task.artifacts)) {
    console.log(
      '[A2A Tool] Processing artifacts for task data (from TaskStatusUpdateEvent):',
      {
        artifactsCount: task.artifacts.length,
      },
    );
    for (const artifact of task.artifacts) {
      console.log('[A2A Tool] Processing artifact:', {
        artifactId: artifact.artifactId,
        partsCount: artifact.parts?.length || 0,
      });

      if (artifact.parts && Array.isArray(artifact.parts)) {
        for (const part of artifact.parts) {
          console.log('[A2A Tool] Processing artifact part:', {
            kind: part.kind,
            hasData: 'data' in part,
            dataType: 'data' in part ? typeof (part as any).data : 'none',
          });

          if (
            part.kind === 'data' &&
            'data' in part &&
            part.data &&
            typeof part.data === 'object'
          ) {
            const partData = part.data as any;
            console.log('[A2A Tool] Found data part with structure:', {
              dataType: partData.type,
              hasTask: !!partData.task,
              taskKeys: partData.task ? Object.keys(partData.task) : [],
              fullData: JSON.stringify(partData, null, 2),
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

              console.log('[A2A Tool] Successfully mapped task:', {
                originalId: taskData.id,
                mappedId: mappedTask.id,
                title: mappedTask.title,
                status: mappedTask.status,
              });

              tasks.push(mappedTask);
            } else {
              console.log(
                '[A2A Tool] Skipping part - not a task type or missing task data:',
                {
                  type: partData.type,
                  hasTask: !!partData.task,
                },
              );
            }
          }
        }
      }
    }
  }

  // Fallback: Check task history for agent messages with task data
  if (tasks.length === 0 && task.history && Array.isArray(task.history)) {
    console.log('[A2A Tool] Processing task history for agent messages:', {
      historyCount: task.history.length,
      historyRoles: task.history.map((msg: any) => msg.role),
    });

    // Look for agent messages in history that contain task data
    for (const historyMessage of task.history) {
      if (
        historyMessage.role === 'agent' &&
        historyMessage.parts &&
        Array.isArray(historyMessage.parts)
      ) {
        console.log('[A2A Tool] Found agent message in history with parts:', {
          partsCount: historyMessage.parts.length,
          partTypes: historyMessage.parts.map((p: any) => p.kind),
        });

        for (const part of historyMessage.parts) {
          if (
            part.kind === 'data' &&
            'data' in part &&
            part.data &&
            typeof part.data === 'object'
          ) {
            const partData = part.data as any;
            console.log('[A2A Tool] Found data part in history:', {
              dataType: partData.type,
              hasTask: !!partData.task,
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

              console.log('[A2A Tool] Extracted task from history:', {
                id: mappedTask.id,
                title: mappedTask.title,
              });
              tasks.push(mappedTask);
            }
          }
        }
      }
    }
  }

  // Additional fallback: Check if task has parts directly (Message-like structure)
  const taskAsAny = task as any;
  if (tasks.length === 0 && taskAsAny.parts && Array.isArray(taskAsAny.parts)) {
    console.log(
      '[A2A Tool] Processing task with parts (Message-like structure, fallback):',
      {
        partsCount: taskAsAny.parts.length,
        partTypes: taskAsAny.parts.map((p: any) => p.kind),
      },
    );

    for (const part of taskAsAny.parts) {
      if (
        part.kind === 'data' &&
        'data' in part &&
        part.data &&
        typeof part.data === 'object'
      ) {
        const partData = part.data as any;
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
          tasks.push(mappedTask);
        }
      }
    }
  }

  // As a final fallback, if no structured tasks were found, try to extract from task status message
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
