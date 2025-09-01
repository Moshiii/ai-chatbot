'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface TaskPart {
  type: 'data-task';
  data: {
    task: {
      id: string;
      title: string;
      description: string;
      status: string;
      assignedAgent?: any;
    };
  };
}

interface TaskCollectorProps {
  taskParts: TaskPart[];
  chatId: string;
  onCanvasCreated: (canvas: {
    id: string;
    taskIds: string[];
    webhookToken: string;
  }) => void;
}

interface CanvasResponse {
  success: boolean;
  canvas: {
    id: string;
    title: string;
    taskIds: string[];
    tasks: any[];
    webhookToken: string;
  };
  message: string;
}

export function TaskCollector({
  taskParts,
  chatId,
  onCanvasCreated,
}: TaskCollectorProps) {
  const [status, setStatus] = useState<
    'collecting' | 'creating' | 'completed' | 'error'
  >('collecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const createTasksAndCanvas = async () => {
      try {
        setStatus('creating');

        // Step 1: Extract tasks from the parts
        const tasks = taskParts.map((part) => part.data.task);

        console.log('[TaskCollector] Step 1: Storing tasks in database...');

        // Step 2: First, store tasks in database via /api/tasks/create
        const taskResponse = await fetch('/api/tasks/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tasks,
            chatId,
          }),
        });

        if (!taskResponse.ok) {
          const errorData = await taskResponse.json();
          throw new Error(errorData.message || 'Failed to store tasks');
        }

        const taskData = await taskResponse.json();
        if (!taskData.success) {
          throw new Error(taskData.message || 'Task storage failed');
        }

        console.log(
          '[TaskCollector] ✅ Tasks stored successfully:',
          taskData.taskIds,
        );
        console.log('[TaskCollector] Step 2: Creating canvas document...');

        // Step 3: Now create canvas document with existing task IDs
        const canvasResponse = await fetch('/api/canvas/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskIds: taskData.taskIds,
            chatId,
            title: 'Task Planning Canvas',
          }),
        });

        if (!canvasResponse.ok) {
          const errorData = await canvasResponse.json();
          throw new Error(errorData.message || 'Failed to create canvas');
        }

        const canvasData = await canvasResponse.json();
        if (!canvasData.success) {
          throw new Error(canvasData.message || 'Canvas creation failed');
        }

        console.log(
          '[TaskCollector] ✅ Canvas created successfully:',
          canvasData.canvas,
        );

        // Notify parent component
        onCanvasCreated({
          id: canvasData.canvas.id,
          taskIds: canvasData.canvas.taskIds,
          webhookToken: taskData.webhookToken, // Use webhook token from task creation
        });

        setStatus('completed');
      } catch (err) {
        console.error('[TaskCollector] Error in sequential process:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus('error');
      }
    };

    // Only start the process if we have task parts and haven't started yet
    if (taskParts.length > 0 && status === 'collecting') {
      createTasksAndCanvas();
    }
  }, [taskParts, chatId, onCanvasCreated, status]);

  const renderStatus = () => {
    switch (status) {
      case 'collecting':
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Collecting tasks from external agent...
          </div>
        );

      case 'creating':
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <Loader2 className="size-4 animate-spin" />
              Step 1: Storing tasks in database...
            </div>
            <div className="flex items-center gap-2 text-sm text-orange-600">
              <Loader2 className="size-4 animate-spin" />
              Step 2: Creating canvas document...
            </div>
          </div>
        );

      case 'completed':
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="size-4" />
              Step 1: Tasks stored in database ✓
            </div>
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="size-4" />
              Step 2: Canvas document created ✓
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="size-4" />
            <span>Failed to create canvas: {error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus('collecting')}
            >
              Retry
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="mt-4 p-4 border rounded-lg bg-muted/50">
      <div className="flex items-center gap-2 mb-2">
        <div className="size-4 bg-green-500 rounded" />
        <span className="text-sm font-medium">
          Task Collection ({taskParts.length} tasks)
        </span>
      </div>

      <div className="mb-2">
        <p className="text-sm text-muted-foreground">
          The external agent has generated tasks. Following the correct
          sequence:
          <br />• First, store all tasks in the database
          <br />• Then, create the canvas document with task references
        </p>
      </div>

      {renderStatus()}

      {status === 'collecting' && (
        <div className="mt-2 space-y-1">
          {taskParts.map((part) => (
            <div
              key={part.data.task.id}
              className="text-xs text-muted-foreground"
            >
              • {part.data.task.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
