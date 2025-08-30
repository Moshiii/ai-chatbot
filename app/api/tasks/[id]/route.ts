import { type NextRequest, NextResponse } from 'next/server';
import { getTaskById } from '@/lib/db/queries';
import type { Task } from '@/lib/db/schema';
import { auth } from '@/app/(auth)/auth';
import type { TaskResultData, TaskStatusResponse } from '@/lib/types/tasks';

// Extended Task type with properly typed result field
interface TaskWithResult extends Omit<Task, 'result'> {
  result?: TaskResultData;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: taskId } = await params;
    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 },
      );
    }

    // Fetch the task using existing query function
    const taskData = await getTaskById({ id: taskId });

    if (!taskData.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const foundTask = taskData[0];

    // Type the task properly (excluding sensitive webhook token)
    const taskWithResult: TaskWithResult = {
      ...foundTask,
      result: foundTask.result as TaskResultData | undefined,
    };

    // Build properly typed task response
    const taskResponse: TaskStatusResponse = {
      id: taskWithResult.id,
      status: taskWithResult.status,
      title: taskWithResult.result?.title || 'Unnamed Task',
      description: taskWithResult.result?.description || '',
      assignedAgent: taskWithResult.result?.assignedAgent,
      statusMessage: taskWithResult.statusMessage || undefined,
      updatedAt: taskWithResult.updatedAt?.toISOString(),
      createdAt: taskWithResult.createdAt?.toISOString(),
    };

    return NextResponse.json(taskResponse);
  } catch (error) {
    console.error('[Task API] Error fetching task:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
