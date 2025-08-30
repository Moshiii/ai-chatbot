import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import {
  createTask,
  saveDocument,
  saveMessages,
  updateDocumentTaskIds,
} from '@/lib/db/queries';
import { generateUUID } from '@/lib/utils';
import { generateDocumentIds } from '@/lib/id-management';
import { ChatSDKError } from '@/lib/errors';
import type {
  TaskResultData,
  CanvasCreateRequest,
  TaskState,
} from '@/lib/types/tasks';

/**
 * Canvas Creation API
 * Creates a canvas document and associated tasks in a single transaction
 * This endpoint is called by the frontend after collecting task data from A2A responses
 */
export async function POST(request: NextRequest) {
  console.log('[Canvas Create API] Received canvas creation request');

  try {
    // 1. Authentication
    const session = await auth();
    if (!session?.user) {
      console.log('[Canvas Create API] Unauthorized - no session');
      return new ChatSDKError('unauthorized:auth').toResponse();
    }

    // 2. Parse and validate request
    const body: CanvasCreateRequest = await request.json();
    const { tasks, chatId } = body;

    console.log(
      `[Canvas Create API] Creating ${tasks.length} tasks for chat ${chatId}, user: ${session.user.id}`,
    );

    // 3. Validate required fields
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return new ChatSDKError(
        'bad_request:api',
        'Tasks array is required and must not be empty',
      ).toResponse();
    }

    if (!chatId) {
      return new ChatSDKError(
        'bad_request:api',
        'Chat ID is required',
      ).toResponse();
    }

    // 4. Generate secure webhook token for all tasks
    const webhookToken = generateUUID();
    console.log('[Canvas Create API] Generated webhook token for tasks');

    // 5. Generate canvas document IDs
    const documentIds = generateDocumentIds('Task Planning Canvas', 'canvas');
    const canvasDocumentId = documentIds.document.databaseId;

    // 6. Create all tasks with the same webhook token
    console.log('[Canvas Create API] Creating tasks...');
    const createdTasks = await Promise.all(
      tasks.map(async (taskInput, index) => {
        const taskId = taskInput.id || generateUUID();

        const taskResult: TaskResultData = {
          title: taskInput.title,
          description: taskInput.description,
          assignedAgent: taskInput.assignedAgent,
          order: index,
        };

        const taskStatus: TaskState = taskInput.status || 'submitted';

        const taskData = {
          id: taskId,
          contextId: chatId,
          status: taskStatus,
          statusMessage: `Task ${index + 1} of ${tasks.length}: ${taskInput.title}`,
          result: taskResult,
          webhookToken,
        };

        await createTask(taskData);
        console.log(`[Canvas Create API] Created task: ${taskId}`);

        return taskData;
      }),
    );

    // 7. Create canvas document linking all tasks
    console.log('[Canvas Create API] Creating canvas document...');
    await saveDocument({
      id: canvasDocumentId,
      title: 'Task Planning Canvas',
      kind: 'canvas',
      content: JSON.stringify({
        tasks: createdTasks.map((t) => ({
          id: t.id,
          title: t.result.title,
          description: t.result.description,
          status: t.status,
          assignedAgent: t.result.assignedAgent,
        })),
        createdAt: new Date().toISOString(),
        totalTasks: tasks.length,
      }),
      userId: session.user.id,
    });

    // 8. Update document with task IDs
    const taskIds = createdTasks.map((task) => task.id);
    await updateDocumentTaskIds({
      documentId: canvasDocumentId,
      taskIds,
    });

    // 9. Create a message in the chat with canvas reference
    console.log(
      '[Canvas Create API] Creating chat message with canvas reference...',
    );
    const canvasMessageId = generateUUID();
    await saveMessages({
      messages: [
        {
          id: canvasMessageId,
          chatId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: `I've created a task planning canvas with ${tasks.length} tasks. The canvas shows the breakdown and agent assignments.`,
            },
            {
              type: 'data-canvasReference',
              data: {
                artifactType: 'document',
                documentId: canvasDocumentId,
                taskIds,
                webhookToken,
              },
            },
          ],
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    console.log(
      `[Canvas Create API] Successfully created canvas ${canvasDocumentId} with ${tasks.length} tasks`,
    );

    // 10. Return success response
    return NextResponse.json(
      {
        success: true,
        canvas: {
          id: canvasDocumentId,
          title: 'Task Planning Canvas',
          taskIds,
          tasks: createdTasks,
          webhookToken,
          referenceId: documentIds.document.referenceId,
        },
        message: `Created canvas with ${tasks.length} tasks`,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[Canvas Create API] Error:', error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      'bad_request:api',
      'Failed to create canvas and tasks',
    ).toResponse();
  }
}
