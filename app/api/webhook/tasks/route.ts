import { type NextRequest, NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import {
  db,
  updateTask,
  createTask,
  updateDocumentTaskIds,
  getDocumentById,
} from '@/lib/db/queries';
import { task, document, type taskStatusEnum } from '@/lib/db/schema';
import { generateUUID } from '@/lib/utils';

/**
 * A2A Task Webhook
 * Handles both task creation and updates from A2A external agents
 * - Task creation: When A2A agent sends artifacts with task data
 * - Task updates: When A2A agent sends status updates for existing tasks
 */

export async function POST(request: NextRequest) {
  try {
    // Extract and validate Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing authorization header' },
        { status: 401 },
      );
    }

    const providedToken = authHeader.substring(7);

    console.log('[Webhook] Received task execution update');

    // Parse request body
    const body = await request.json();
    console.log('[Webhook] Received payload:', JSON.stringify(body, null, 2));

    // Validate required fields
    const { id: taskId, documentId, contextId, status, artifacts } = body;
    if (!taskId || !contextId) {
      return NextResponse.json(
        { error: 'Missing required fields: id, contextId' },
        { status: 400 },
      );
    }

    // Check if this is a task creation request (has artifacts with task data)
    let isTaskCreation = false;
    const tasksToCreate: any[] = [];

    if (artifacts && artifacts.length > 0) {
      console.log('[Webhook] Processing artifacts for task data');
      for (const artifact of artifacts) {
        if (artifact.parts) {
          for (const part of artifact.parts) {
            if (
              part.kind === 'data' &&
              part.data?.type === 'task' &&
              part.data?.task
            ) {
              isTaskCreation = true;
              tasksToCreate.push({
                ...part.data.task,
                contextId,
                webhookToken: providedToken,
              });
              console.log(
                '[Webhook] Found task data in artifact:',
                part.data.task.title,
              );
            }
          }
        }
      }
    }

    if (isTaskCreation && tasksToCreate.length > 0) {
      console.log(
        `[Webhook] Creating ${tasksToCreate.length} new tasks from A2A artifacts`,
      );

      // Create tasks from artifacts
      const createdTaskIds: string[] = [];
      for (const taskData of tasksToCreate) {
        try {
          const newTaskId = taskData.id || generateUUID();
          const [createdTask] = await createTask({
            id: newTaskId,
            contextId: taskData.contextId,
            status: (taskData.status ||
              'submitted') as (typeof taskStatusEnum)[number],
            statusMessage: taskData.description || taskData.title,
            result: {
              title: taskData.title || 'Unnamed Task',
              description: taskData.description || '',
              priority: taskData.priority || 'medium',
              assignedAgent: taskData.assignedAgent,
            },
            webhookToken: taskData.webhookToken,
          });

          if (createdTask) {
            createdTaskIds.push(createdTask.id);
            console.log(
              `[Webhook] Created task: ${createdTask.id} - ${taskData.title}`,
            );
          }
        } catch (error) {
          console.error('[Webhook] Error creating task:', error);
        }
      }

      // Link tasks to canvas document by finding it via contextId
      if (createdTaskIds.length > 0) {
        try {
          // Find canvas document by contextId (which should match the chatId)
          // This is a simplified approach - in production you might want a more robust lookup
          const canvasDocuments = await db
            .select()
            .from(document)
            .where(eq(document.kind, 'canvas'))
            .orderBy(desc(document.createdAt))
            .limit(10); // Get recent canvas documents

          // Find the most recent canvas document that might be associated with this context
          // This is a heuristic - ideally we'd have a direct contextId -> documentId mapping
          let targetCanvas = null;
          if (documentId) {
            // If documentId is provided in webhook, use it directly
            targetCanvas = await getDocumentById({ id: documentId });
          } else if (canvasDocuments.length > 0) {
            // Otherwise, use the most recent canvas document as fallback
            targetCanvas = canvasDocuments[0];
            console.log(
              `[Webhook] Using most recent canvas document as fallback: ${targetCanvas.id}`,
            );
          }

          if (targetCanvas) {
            const currentTaskIds = targetCanvas.taskIds || [];
            const newTaskIds = [...currentTaskIds, ...createdTaskIds];
            await updateDocumentTaskIds({
              documentId: targetCanvas.id,
              taskIds: newTaskIds,
            });
            console.log(
              `[Webhook] Linked ${createdTaskIds.length} tasks to canvas ${targetCanvas.id}`,
            );
          } else {
            console.log('[Webhook] No canvas document found to link tasks to');
          }
        } catch (error) {
          console.error('[Webhook] Error linking tasks to canvas:', error);
        }
      }

      console.log(
        `[Webhook] Successfully created ${createdTaskIds.length} tasks`,
      );
      return new Response(null, { status: 204 });
    }

    // Handle task updates (existing logic)
    if (!status) {
      return NextResponse.json(
        { error: 'Missing status for task update' },
        { status: 400 },
      );
    }

    // Validate status is a valid task status
    const validStatuses = [
      'submitted',
      'working',
      'input-required',
      'completed',
      'canceled',
      'failed',
      'rejected',
      'auth-required',
      'unknown',
    ];

    if (!validStatuses.includes(status.state)) {
      return NextResponse.json(
        { error: 'Invalid task status' },
        { status: 400 },
      );
    }

    // For task updates, verify webhook token matches stored token
    const existingTasks = await db
      .select()
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);

    if (existingTasks.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const existingTask = existingTasks[0];
    if (existingTask.webhookToken !== providedToken) {
      console.log(
        `[Webhook] Token mismatch for task ${taskId}: expected ${existingTask.webhookToken}, got ${providedToken}`,
      );
      return NextResponse.json(
        { error: 'Invalid webhook token' },
        { status: 401 },
      );
    }

    // Extract status message and result from artifacts if available
    let statusMessage = status.message || null;
    let result = null;

    if (artifacts && artifacts.length > 0) {
      // Look for data parts in artifacts
      for (const artifact of artifacts) {
        if (artifact.parts) {
          for (const part of artifact.parts) {
            if (part.kind === 'data' && part.data) {
              result = part.data;
              break;
            }
            if (part.kind === 'text' && part.text) {
              statusMessage = part.text;
            }
          }
        }
      }
    }

    // Update the task
    await updateTask({
      id: taskId,
      status: status.state,
      statusMessage,
      result,
    });

    // Update the document's taskIds array if documentId is provided
    if (documentId) {
      const documentData = await db
        .select()
        .from(document)
        .where(eq(document.id, documentId))
        .limit(1);

      if (documentData.length > 0) {
        const currentTaskIds = documentData[0].taskIds || [];
        if (!currentTaskIds.includes(taskId)) {
          const updatedTaskIds = [...currentTaskIds, taskId];
          await updateDocumentTaskIds({
            documentId,
            taskIds: updatedTaskIds,
          });
        }
      }
    }

    console.log(`[Webhook] Task ${taskId} updated to status: ${status.state}`);

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('[Webhook] Error processing task update:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
