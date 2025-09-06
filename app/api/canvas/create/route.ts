import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import {
  saveDocument,
  updateDocumentTaskIds,
  getTaskById,
} from '@/lib/db/queries';
import { generateDocumentIds } from '@/lib/id-management';
import { ChatSDKError } from '@/lib/errors';

interface CanvasCreateRequest {
  taskIds: string[];
  chatId: string;
  title?: string;
}

/**
 * Canvas Document Creation API
 * Creates ONLY the canvas document with references to existing task IDs
 * Tasks must already exist in the database before calling this endpoint
 *
 * This endpoint should be called AFTER tasks are successfully stored via /api/tasks/create
 */
export async function POST(request: NextRequest) {
  console.log('[Canvas Create API] Received canvas document creation request');

  try {
    // 1. Authentication
    const session = await auth();
    if (!session?.user) {
      console.log('[Canvas Create API] Unauthorized - no session');
      return new ChatSDKError('unauthorized:auth').toResponse();
    }

    // 2. Parse and validate request
    const body: CanvasCreateRequest = await request.json();
    const { taskIds, chatId, title = 'Task Planning Canvas' } = body;

    console.log(
      `[Canvas Create API] Creating canvas document for ${taskIds.length} existing tasks in chat ${chatId}`,
    );

    // 3. Validate required fields
    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return new ChatSDKError(
        'bad_request:api',
        'Task IDs array is required and must not be empty',
      ).toResponse();
    }

    if (!chatId) {
      return new ChatSDKError(
        'bad_request:api',
        'Chat ID is required',
      ).toResponse();
    }

    // 4. Verify that all tasks exist in the database
    console.log('[Canvas Create API] Verifying all tasks exist...');
    const taskDetails: any[] = [];
    for (const taskId of taskIds) {
      const existingTask = await getTaskById({ id: taskId });
      if (!existingTask || existingTask.length === 0) {
        return new ChatSDKError(
          'bad_request:api',
          `Task with ID ${taskId} does not exist`,
        ).toResponse();
      }
      taskDetails.push(existingTask[0]);
    }
    console.log('[Canvas Create API] ✅ All tasks verified to exist');

    // 5. Generate canvas document IDs
    const documentIds = generateDocumentIds(title, 'canvas');
    const canvasDocumentId = documentIds.document.databaseId;

    console.log(
      `[Canvas Create API] Creating canvas document with task references: ${taskIds.join(', ')}`,
    );

    // 6. Create canvas document with task references
    await saveDocument({
      id: canvasDocumentId,
      title,
      kind: 'canvas',
      content: JSON.stringify({
        tasks: taskDetails.map((task) => ({
          id: task.id,
          title: task.result?.title || 'Untitled Task',
          description: task.result?.description || '',
          status: task.status,
          assignedAgent: task.result?.assignedAgent,
        })),
        createdAt: new Date().toISOString(),
        totalTasks: taskIds.length,
      }),
      userId: session.user.id,
    });

    // 7. Update document with task IDs
    await updateDocumentTaskIds({
      documentId: canvasDocumentId,
      taskIds,
    });

    console.log(
      `[Canvas Create API] ✅ Canvas document created with ${taskIds.length} task references`,
    );

    // 8. Return success response
    return NextResponse.json(
      {
        success: true,
        canvas: {
          id: canvasDocumentId,
          title,
          taskIds,
          referenceId: documentIds.document.referenceId,
          // Optional convenience: echo minimal task details for UI if needed later
          tasks: taskDetails.map((t) => ({
            id: t.id,
            status: t.status,
            title: t.result?.title || 'Untitled Task',
            description: t.result?.description || '',
          })),
        },
        message: `Canvas document created with ${taskIds.length} task references`,
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
      'Failed to create canvas document',
    ).toResponse();
  }
}
