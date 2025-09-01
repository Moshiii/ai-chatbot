import { type NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, updateTask, updateDocumentTaskIds } from '@/lib/db/queries';
import { task, document } from '@/lib/db/schema';

/**
 * Task Execution Webhook
 * Handles task execution updates (completion/failure) from external agent
 * Note: Initial task creation is handled via direct response, not webhooks
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

    // Validate required fields
    const { id: taskId, documentId, contextId, status, artifacts } = body;
    if (!taskId || !contextId || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: id, contextId, status' },
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

    // Verify webhook token matches stored token
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
