import { useEffect, useState, useRef, useMemo } from 'react';
import type {
  AssignedAgent,
  TaskStatusResponse,
  TaskState,
} from '@/lib/types/tasks';

// Local interface for the hook's internal task representation
interface Task {
  id: string;
  status: TaskState; // Use proper TaskState type
  title: string;
  description: string;
  assignedAgent?: AssignedAgent;
}

interface UseTaskPollingOptions {
  canvasId?: string;
  taskIds?: string[];
  pollInterval?: number;
  enabled?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  onError?: (error: string) => void;
  onStatusUpdate?: (statuses: Map<string, TaskStatusResponse>) => void;
}

interface UseTaskPollingReturn {
  taskStatuses: Map<string, TaskStatusResponse>;
  isPolling: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Terminal task statuses - polling should stop when all tasks reach these states
 */
const TERMINAL_STATUSES = ['completed', 'failed', 'canceled', 'rejected'];

/**
 * Hook for polling task status updates with smart stopping logic
 */
export function useTaskPolling({
  canvasId,
  taskIds = [],
  pollInterval = 5000,
  enabled = true,
  maxRetries = 3,
  retryDelay = 1000,
  onError,
  onStatusUpdate,
}: UseTaskPollingOptions): UseTaskPollingReturn {
  // Create stable reference for taskIds to prevent unnecessary re-renders
  const taskIdsKey = useMemo(() => {
    return taskIds.length > 0 ? taskIds.sort().join(',') : '';
  }, [taskIds]);
  const [taskStatuses, setTaskStatuses] = useState<
    Map<string, TaskStatusResponse>
  >(new Map());
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPollTime = useRef<number>(0);

  const shouldStopPolling = (
    statuses: Map<string, TaskStatusResponse>,
  ): boolean => {
    if (statuses.size === 0) return false;

    // Stop polling only when ALL tasks are in terminal states
    return Array.from(statuses.values()).every((task) =>
      TERMINAL_STATUSES.includes(task.status),
    );
  };

  const fetchTaskStatusWithRetry = async (
    taskId: string,
    attempt = 1,
  ): Promise<TaskStatusResponse | null> => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(
        `[TaskPolling] Error fetching task ${taskId} (attempt ${attempt}):`,
        error,
      );

      if (attempt < maxRetries) {
        console.log(
          `[TaskPolling] Retrying task ${taskId} in ${retryDelay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        return fetchTaskStatusWithRetry(taskId, attempt + 1);
      }

      return null; // Failed after all retries
    }
  };

  const fetchTaskStatuses = async (): Promise<void> => {
    if (!taskIds.length || !enabled) return;

    try {
      setError(null);
      lastPollTime.current = Date.now();

      console.log('[TaskPolling] Fetching statuses for tasks:', taskIds);

      // Fetch status for each task with retry logic
      const statusPromises = taskIds.map((taskId) =>
        fetchTaskStatusWithRetry(taskId),
      );
      const results = await Promise.all(statusPromises);

      // Filter out failed requests and update state
      const validStatuses = results.filter(
        (result): result is TaskStatusResponse => result !== null,
      );

      // Check if we had any failures
      const failedCount = results.length - validStatuses.length;
      if (failedCount > 0) {
        const errorMessage = `Failed to fetch ${failedCount} task(s) after ${maxRetries} retries`;
        console.warn(`[TaskPolling] ${errorMessage}`);
        setError(errorMessage);
        onError?.(errorMessage);
      }

      const newStatuses = new Map<string, TaskStatusResponse>();
      validStatuses.forEach((status) => {
        newStatuses.set(status.id, status);
      });

      setTaskStatuses(newStatuses);
      onStatusUpdate?.(newStatuses);

      // Check if we should stop polling
      if (shouldStopPolling(newStatuses)) {
        console.log(
          '[TaskPolling] All tasks in terminal states, stopping polling',
        );
        setIsPolling(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }

      console.log(
        '[TaskPolling] Updated task statuses:',
        Object.fromEntries(newStatuses),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(
        '[TaskPolling] Error fetching task statuses:',
        errorMessage,
      );
      setError(errorMessage);
      onError?.(errorMessage);
    }
  };

  const startPolling = (): void => {
    if (!enabled || !taskIds.length || isPolling) return;

    console.log('[TaskPolling] Starting polling for tasks:', taskIds);
    setIsPolling(true);

    // Initial fetch
    fetchTaskStatuses();

    // Set up interval polling
    intervalRef.current = setInterval(fetchTaskStatuses, pollInterval);
  };

  const stopPolling = (): void => {
    console.log('[TaskPolling] Stopping polling');
    setIsPolling(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Effect to start/stop polling based on dependencies
  useEffect(() => {
    if (enabled && taskIds.length > 0 && !isPolling) {
      startPolling();
    } else if ((!enabled || taskIds.length === 0) && isPolling) {
      stopPolling();
    }

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, taskIds.length, isPolling]);

  // Effect to restart polling when taskIds change
  useEffect(() => {
    if (enabled && taskIds.length > 0) {
      // Stop current polling
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Reset state and start fresh
      setTaskStatuses(new Map());
      setError(null);
      setIsPolling(false);
      // The previous useEffect will handle starting polling again
    }
  }, [taskIdsKey, enabled, taskIds.length]);

  const refetch = async (): Promise<void> => {
    await fetchTaskStatuses();
  };

  return {
    taskStatuses,
    isPolling,
    error,
    refetch,
  };
}
