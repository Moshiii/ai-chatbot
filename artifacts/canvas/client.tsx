import { Artifact } from '@/components/create-artifact';
import { CanvasFlow } from '../../components/canvas-flow';
import React from 'react';

import {
  ClockRewind,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons';
import { toast } from 'sonner';

// Canvas data structure received from tools
interface CanvasData {
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in-progress' | 'completed' | 'recruiting';
    assignedAgent?: {
      id: string;
      name: string;
      description: string;
      capabilities: string[];
      pricingUsdt?: number;
      walletAddress?: string;
      rating?: number;
      completedTasks?: number;
    };
  }>;
  agents?: Array<{
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
  documentId?: string;
  title?: string;
}

// Simple Canvas Content Component
interface CanvasContentProps {
  content: string;
  mode: string;
  status: string;
  isCurrentVersion: boolean;
  currentVersionIndex: number;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  getDocumentContentById: (id: number) => string;
  isLoading: boolean;
}

const CanvasContent: React.FC<CanvasContentProps> = ({
  content,
  mode,
  status,
  isCurrentVersion,
  currentVersionIndex,
  onSaveContent,
  getDocumentContentById,
  isLoading,
}) => {
  // Debug: Log what we actually receive
  console.log('[Canvas Debug] 🔍 Content received:', {
    content,
    contentType: typeof content,
    contentLength: content?.length || 0,
    status,
    isLoading,
    timestamp: new Date().toISOString(),
  });

  // Parse canvas data from content
  let canvasData: CanvasData;
  try {
    canvasData = JSON.parse(content || '{}');
    console.log('[Canvas Debug] ✅ Successfully parsed canvas data:', {
      taskCount: canvasData.tasks?.length || 0,
      hasDocumentId: !!canvasData.documentId,
      hasTitle: !!canvasData.title,
      tasks: canvasData.tasks?.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    });
  } catch {
    // If content is not JSON, show initializing state
    if (status === 'streaming' || isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-700">
              Canvas Loading...
            </div>
            <div className="text-sm text-gray-500 mt-2">
              Generating task visualization
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-700">
            No Canvas Data
          </div>
          <div className="text-sm text-gray-500 mt-2">
            Unable to load canvas content
          </div>
        </div>
      </div>
    );
  }

  // Handle diff mode
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

  // Extract data for CanvasFlow
  const tasks = canvasData.tasks || [];
  const agents = canvasData.agents || [];

  console.log('[Canvas Debug] 🎨 Rendering Canvas with data:', {
    taskCount: tasks.length,
    agentCount: agents.length,
    tasksPreview: tasks
      .slice(0, 2)
      .map((t) => ({ id: t.id, title: t.title, status: t.status })),
  });

  // Create mock responses for completed tasks
  const mockResponses = tasks
    .filter((task) => task.status === 'completed')
    .map((task) => ({
      id: `response-${task.id}`,
      agentId: task.assignedAgent?.id || `agent-${task.id}`,
      content: 'Task completed successfully',
      timestamp: new Date(),
    }));

  // Handler for executing all agents
  const handleExecuteAllAgents = async () => {
    if (tasks.length === 0) {
      toast.warning('No tasks available to execute');
      return;
    }

    toast.info(`Executing ${tasks.length} tasks...`);

    try {
      const executionPromises = tasks.map(async (task) => {
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
      toast.success('All tasks execution initiated successfully');
    } catch (error) {
      console.error('Error executing tasks:', error);
      toast.error('Failed to execute some tasks');
    }
  };

  // Handler for summary generation
  const handleSummarize = () => {
    if (mockResponses.length === 0) {
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
          tasks={tasks}
          agents={agents}
          responses={mockResponses}
          summary={null}
          onExecuteAllAgents={handleExecuteAllAgents}
          onSummarize={handleSummarize}
          isGenerating={status === 'streaming' && tasks.length === 0}
          allAgentsExecuted={mockResponses.length === tasks.length}
        />
      </div>
    </div>
  );
};

// Simplified Canvas Artifact - no metadata needed
export const canvasArtifact = new Artifact<'canvas'>({
  kind: 'canvas',
  description:
    'Interactive canvas for task decomposition and agent coordination.',

  onStreamPart: ({ streamPart, setArtifact }) => {
    console.log('[Canvas Artifact] 🔄 Stream received:', {
      type: streamPart.type,
      hasData: 'data' in streamPart,
    });

    // Handle Canvas task data from server handler
    if (streamPart.type === 'data-textDelta') {
      console.log(
        '[Canvas Artifact] 📥 Received Canvas data:',
        streamPart.data,
      );

      try {
        const canvasData = JSON.parse(streamPart.data);

        if (canvasData.tasks && canvasData.tasks.length > 0) {
          console.log(
            '[Canvas Artifact] ✅ Setting Canvas content with tasks:',
            {
              taskCount: canvasData.tasks.length,
              documentId: canvasData.documentId,
            },
          );

          setArtifact((draftArtifact) => ({
            ...draftArtifact,
            content: streamPart.data, // Set the complete JSON task data as content
            isVisible: true,
            status: 'streaming',
          }));

          toast.success(`Canvas created with ${canvasData.tasks.length} tasks`);
        } else {
          console.log('[Canvas Artifact] Received placeholder Canvas data');
        }
      } catch (error) {
        console.log('[Canvas Artifact] Error parsing Canvas data:', error);
      }
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
