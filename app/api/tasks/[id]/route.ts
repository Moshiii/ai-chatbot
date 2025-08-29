import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/queries';
import { task } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/app/(auth)/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = params.id;
    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 },
      );
    }

    // Fetch the task
    const taskData = await db
      .select()
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);

    if (!taskData.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const foundTask = taskData[0];

    // Return task data (excluding sensitive webhook token)
    const { webhookToken, ...safeTask } = foundTask;

    return NextResponse.json(safeTask);
  } catch (error) {
    console.error('[Task API] Error fetching task:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
