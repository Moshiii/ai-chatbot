import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { createTask } from '@/lib/db/queries';
import { generateUUID } from '@/lib/utils';
import { ChatSDKError } from '@/lib/errors';
import type { TaskResultData, TaskState } from '@/lib/types/tasks';

interface TaskCreateRequest {
  tasks: Array<{
    id?: string;
    title: string;
    description: string;
    status?: TaskState;
    assignedAgent?: any;
  }>;
  chatId: string;
}

/**
 * Tasks Creation API
 * Creates and stores tasks in the database
 * Only handles task storage, does not create documents
 */
export async function POST(request: NextRequest) {
  console.log('[Tasks Create API] Received task creation request');

  try {
    // 1. Authentication
    const session = await auth();
    if (!session?.user) {
      console.log('[Tasks Create API] Unauthorized - no session');
      return new ChatSDKError('unauthorized:auth').toResponse();
    }

    // 2. Parse and validate request
    const body: TaskCreateRequest = await request.json();
    const { tasks, chatId } = body;

    console.log(
      `[Tasks Create API] Creating ${tasks.length} tasks for chat ${chatId}, user: ${session.user.id}`,
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
    console.log('[Tasks Create API] Generated webhook token for tasks');

    // 5. Create all tasks in database
    console.log('[Tasks Create API] Creating tasks in database...');
    const createdTasks: any[] = [];

    try {
      for (let index = 0; index < tasks.length; index++) {
        const taskInput = tasks[index];
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
        console.log(`[Tasks Create API] ✓ Task stored: ${taskId}`);
        createdTasks.push(taskData);
      }

      console.log(
        `[Tasks Create API] ✅ All ${createdTasks.length} tasks successfully stored`,
      );
    } catch (error) {
      console.error('[Tasks Create API] ❌ Failed to create tasks:', error);
      throw new Error(`Failed to store tasks in database: ${error}`);
    }

    // 6. Return success response with created task IDs
    const taskIds = createdTasks.map((task) => task.id);
    return NextResponse.json(
      {
        success: true,
        tasks: createdTasks,
        taskIds,
        webhookToken,
        message: `Successfully created ${createdTasks.length} tasks`,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[Tasks Create API] Error:', error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      'bad_request:api',
      'Failed to create tasks',
    ).toResponse();
  }
}
