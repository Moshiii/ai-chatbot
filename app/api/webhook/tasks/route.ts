import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/queries';
import { task, document } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header' },
        { status: 401 },
      );
    }

    const providedToken = authHeader.substring(7);
    if (!providedToken) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 });
    }

    const body = await request.json();

    // Validate required fields
    const { id: taskId, documentId, status, artifacts } = body;
    if (!taskId || !documentId || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: id, documentId, status' },
        { status: 400 },
      );
    }

    // Validate token against stored webhookToken for this task
    const existingTasks = await db
      .select()
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);

    if (!existingTasks.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const foundTask = existingTasks[0];
    if (foundTask.webhookToken !== providedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Update task status and result
    await db
      .update(task)
      .set({
        status: status.state,
        statusMessage: status.message || null,
        result: artifacts || null,
        updatedAt: new Date(),
      })
      .where(eq(task.id, taskId));

    // Update document to link the task
    const existingDocuments = await db
      .select({ taskIds: document.taskIds })
      .from(document)
      .where(eq(document.id, documentId))
      .limit(1);

    if (existingDocuments.length > 0) {
      const currentTaskIds = existingDocuments[0].taskIds || [];
      const updatedTaskIds = Array.from(new Set([...currentTaskIds, taskId]));

      await db
        .update(document)
        .set({
          taskIds: updatedTaskIds,
          content: `Task ${taskId} updated: ${status.state}`,
        })
        .where(eq(document.id, documentId));
    }

    // Log successful webhook processing
    console.log(`[Webhook] Task ${taskId} updated to ${status.state}`);

    // Return 204 No Content as per A2A spec
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[Webhook] Error processing task update:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
