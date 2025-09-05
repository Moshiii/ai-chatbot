import { Artifact } from '@/components/create-artifact';
import { CanvasFlow } from '../../components/canvas-flow';
import { DocumentSkeleton } from '@/components/document-skeleton';
import React, { useEffect } from 'react';

import {
  ClockRewind,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons';
import type { Suggestion, Document } from '@/lib/db/schema';
import { toast } from 'sonner';
import useSWR from 'swr';
import { fetcher } from '@/lib/utils';
import { transformTaskStatusToUI } from '@/lib/types';
import type { TaskStatusResponse } from '@/lib/types/tasks';

// Canvas Content Component - simplified and focused
interface CanvasContentProps {
  mode: string;
  status: string;
  content: string;
  isCurrentVersion: boolean;
  currentVersionIndex: number;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  getDocumentContentById: (id: number) => string;
  isLoading: boolean;
}

const CanvasContent: React.FC<CanvasContentProps> = ({
  mode,
  status,
  content,
  isCurrentVersion,
  currentVersionIndex,
  onSaveContent,
  getDocumentContentById,
  isLoading,
}) => {
  // Simple document ID resolution - content should be the document ID
  const documentId = content;

  // Fetch canvas document with more debugging
  const {
    data: canvasDocument,
    isLoading: isDocumentLoading,
    mutate: mutateDocument,
  } = useSWR<Document>(
    documentId && documentId !== 'init'
      ? `canvas-document-${documentId}`
      : null,
    async () => {
      if (!documentId || documentId === 'init') {
        return null;
      }
      return await fetcher(`/api/document?id=${documentId}`);
    },
  );

  // Fetch tasks based on document task IDs
  const {
    data: tasksData,
    isLoading: isTasksLoading,
    mutate: mutateTasks,
  } = useSWR<TaskStatusResponse[]>(
    canvasDocument?.taskIds?.length
      ? `tasks-data-${canvasDocument.id}-${canvasDocument.taskIds.join(',')}`
      : null,
    async () => {
      const taskIds = canvasDocument?.taskIds || [];
      if (taskIds.length === 0) {
        return [];
      }

      try {
        const responses = await Promise.all(
          taskIds.map(async (taskId: string) => {
            const task: TaskStatusResponse = await fetcher(
              `/api/tasks/${taskId}`,
            );
            return task;
          }),
        );
        return responses.filter(Boolean);
      } catch (error) {
        console.error('Error fetching tasks:', error);
        toast.error('Failed to fetch task details.');
        return [];
      }
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  // Auto-retry document fetch if tasks not found
  useEffect(() => {
    if (
      !isLoading &&
      !isDocumentLoading &&
      !isTasksLoading &&
      canvasDocument &&
      (!canvasDocument.taskIds || canvasDocument.taskIds.length === 0) &&
      status === 'streaming'
    ) {
      const retryTimer = setTimeout(() => {
        mutateDocument();
      }, 2000);
      return () => clearTimeout(retryTimer);
    }
  }, [
    isLoading,
    isDocumentLoading,
    isTasksLoading,
    canvasDocument,
    status,
    mutateDocument,
  ]);

  // Loading states
  if (isLoading || isDocumentLoading) {
    return <DocumentSkeleton artifactKind="canvas" />;
  }

  if (!documentId || documentId === 'init') {
    // If we're streaming, give it some time for the content to arrive
    if (status === 'streaming' && !isLoading) {
      return <DocumentSkeleton artifactKind="canvas" />;
    }

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-700">
            Canvas Initializing
          </div>
          <div className="text-sm text-gray-500 mt-2">
            Waiting for document to be created...
          </div>
        </div>
      </div>
    );
  }

  if (isTasksLoading) {
    return <DocumentSkeleton artifactKind="canvas" />;
  }

  // Diff mode
  if (mode === 'diff') {
    const oldContent = getDocumentContentById(currentVersionIndex - 1);
    const newContent = getDocumentContentById(currentVersionIndex);

    return (
      <div className="flex flex-col py-8 md:p-20 px-4">
        <div className="text-sm text-muted-foreground mb-4">
          Canvas diff view not available
        </div>
        <div className="bg-muted p-4 rounded-lg">
          <div className="font-semibold mb-2">Previous:</div>
          <div className="text-sm">{oldContent}</div>
          <div className="font-semibold mb-2 mt-4">Current:</div>
          <div className="text-sm">{newContent}</div>
        </div>
      </div>
    );
  }

  // Transform database tasks to UI format
  const uiTasks = (tasksData || []).map((task) => ({
    id: task.id,
    title: task.title || `Task ${task.id.slice(-8)}`,
    description:
      task.description || task.statusMessage || `Status: ${task.status}`,
    status: transformTaskStatusToUI(task.status),
  }));

  // Extract agents from tasks
  const uiAgents = (tasksData || [])
    .filter((task) => task.assignedAgent)
    .map((task) => {
      const agent = task.assignedAgent;
      if (!agent) return null;

      return {
        id: agent.id || `agent-${task.id}`,
        name: agent.name || `Agent for ${task.title || 'Task'}`,
        description: agent.description || 'A2A Agent',
        capabilities: agent.capabilities || ['task-execution'],
        taskId: task.id,
        pricingUsdt: agent.pricingUsdt,
        walletAddress: agent.walletAddress,
        rating: agent.rating,
        completedTasks: agent.completedTasks,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    taskId: string;
    pricingUsdt?: number;
    walletAddress?: string;
    rating?: number;
    completedTasks?: number;
  }>;

  // Mock responses for completed tasks
  const mockResponses = uiTasks
    .filter((task) => task.status === 'completed')
    .map((task) => ({
      id: `response-${task.id}`,
      agentId: `agent-${task.id}`,
      content: 'Task completed successfully',
      timestamp: new Date(),
    }));

  // Handler for executing all agents
  const handleExecuteAllAgents = async () => {
    if (!tasksData || tasksData.length === 0) {
      toast.warning('No tasks available to execute');
      return;
    }

    toast.info(`Executing ${tasksData.length} tasks...`);

    try {
      const executionPromises = tasksData.map(async (task) => {
        const response = await fetch('/api/agent/execution', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskId: task.id,
            executionMode: 'parallel',
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Task ${task.id}: ${error || response.statusText}`);
        }

        return response;
      });

      await Promise.all(executionPromises);

      // Refresh data after execution
      mutateTasks();
      mutateDocument();

      toast.success('All tasks execution initiated successfully');
    } catch (error) {
      console.error('Error executing tasks:', error);
      toast.error('Failed to execute some tasks');
    }
  };

  // Handler for summary generation
  const handleSummarize = () => {
    if (!mockResponses || mockResponses.length === 0) {
      toast.warning('No task responses available to summarize');
      return;
    }

    toast.info('Requesting summary from orchestrator...');
    // TODO: Implement summary generation via A2A agent
  };

  return (
    <div className="flex flex-col h-full">
      <div className="relative size-full">
        <CanvasFlow
          tasks={uiTasks}
          agents={uiAgents}
          responses={mockResponses}
          summary={null}
          onExecuteAllAgents={handleExecuteAllAgents}
          onSummarize={handleSummarize}
          isGenerating={
            status === 'streaming' && uiTasks.length === 0 && !isTasksLoading
          }
          allAgentsExecuted={mockResponses.length === uiTasks.length}
        />
      </div>
    </div>
  );
};

// Simplified Canvas Artifact Metadata
interface CanvasArtifactMetadata {
  suggestions: Array<Suggestion>;
}

export const canvasArtifact = new Artifact<'canvas', CanvasArtifactMetadata>({
  kind: 'canvas',
  description:
    'Interactive canvas for task decomposition and agent coordination.',

  initialize: async ({ documentId, setMetadata }) => {
    // Simple initialization - no complex metadata needed since we use useSWR
    setMetadata({
      suggestions: [], // Only keep suggestions for artifact compatibility
    });
  },

  onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
    // Simplified stream handling - focus only on essential events
    if (streamPart.type === 'data-suggestion') {
      try {
        setMetadata((metadata) => ({
          ...metadata,
          suggestions: [...(metadata.suggestions || []), streamPart.data],
        }));
      } catch (error) {
        console.warn('Error handling suggestion stream part:', error);
      }
    }

    if (streamPart.type === 'data-textDelta') {
      try {
        const parsedData = JSON.parse(streamPart.data);

        // Handle canvas ready status
        if (parsedData.status === 'canvas-ready') {
          toast.success(parsedData.message || 'Canvas created successfully');
        }

        // Handle canvas tasks linked notification
        else if (parsedData.type === 'canvas-tasks-linked') {
          toast.success(
            parsedData.message ||
              `Canvas updated with ${parsedData.taskCount} tasks`,
          );
        }
      } catch (error) {
        // Non-JSON data, ignore silently
      }

      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        status: 'streaming',
      }));
    }
  },

  content: ({
    mode,
    status,
    content,
    isCurrentVersion,
    currentVersionIndex,
    onSaveContent,
    getDocumentContentById,
    isLoading,
  }) => (
    <CanvasContent
      mode={mode}
      status={status}
      content={content}
      isCurrentVersion={isCurrentVersion}
      currentVersionIndex={currentVersionIndex}
      onSaveContent={onSaveContent}
      getDocumentContentById={getDocumentContentById}
      isLoading={isLoading}
    />
  ),

  actions: [
    {
      icon: <ClockRewind size={18} />,
      description: 'View changes',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('toggle');
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <UndoIcon size={18} />,
      description: 'View Previous version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('prev');
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <RedoIcon size={18} />,
      description: 'View Next version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('next');
      },
      isDisabled: ({ isCurrentVersion }) => isCurrentVersion,
    },
    {
      icon: <CopyIcon size={18} />,
      description: 'Copy to clipboard',
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success('Copied to clipboard!');
      },
    },
  ],

  toolbar: [
    {
      icon: <PenIcon />,
      description: 'Add new task',
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Please add a new task to the canvas.',
            },
          ],
        });
      },
    },
    {
      icon: <MessageIcon />,
      description: 'Request status update',
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Please provide a status update on the current tasks.',
            },
          ],
        });
      },
    },
  ],
});
