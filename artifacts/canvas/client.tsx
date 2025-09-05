import { Artifact } from '@/components/create-artifact';
import { CanvasFlow } from '../../components/canvas-flow';
import { DocumentSkeleton } from '@/components/document-skeleton';
import React, { useEffect, useRef } from 'react';

import {
  ClockRewind,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons';
import type { Suggestion, Document, Task } from '@/lib/db/schema';
import { toast } from 'sonner';
import useSWR from 'swr';
import { fetcher } from '@/lib/utils';
import { transformTaskStatusToUI } from '@/lib/types';

// Type for task result structure from A2A agent
interface TaskResultData {
  title?: string;
  description?: string;
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
}

// Canvas Content Component that handles all the data fetching and rendering
interface CanvasContentProps {
  mode: string;
  status: string;
  content: string;
  isCurrentVersion: boolean;
  currentVersionIndex: number;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  getDocumentContentById: (id: number) => string;
  isLoading: boolean;
  metadata: CanvasArtifactMetadata;
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
  metadata,
}) => {
  // Extract document ID more intelligently
  // The content might be JSON string containing the document data, or it might be the document ID
  let documentId: string | undefined;

  // First try to use metadata taskId if available
  if (metadata?.taskId) {
    documentId = metadata.taskId;
  }
  // Then try to parse content as potential JSON document data
  else if (content) {
    try {
      const parsedContent = JSON.parse(content);
      // If content is parsed JSON with a taskId, use that
      if (parsedContent.taskId) {
        documentId = parsedContent.taskId;
      }
      // Otherwise treat content as the document ID itself
      else {
        documentId = content;
      }
    } catch {
      // If content is not JSON, treat it as document ID
      documentId = content;
    }
  }

  // Enhanced debugging for Canvas data flow
  console.log('[Canvas Debug] 🔄 Canvas component render:', {
    content: content,
    contentType: typeof content,
    contentLength: content?.length || 0,
    metadataTaskId: metadata?.taskId,
    resolvedDocumentId: documentId,
    status: status,
    mode: mode,
    renderTimestamp: new Date().toISOString(),
  });

  // Track component re-renders that might cause disappearing content
  const renderCountRef = useRef(0);
  const prevDocumentIdRef = useRef(documentId);
  const prevStatusRef = useRef(status);
  const prevContentRef = useRef(content);

  renderCountRef.current++;
  const renderInfo = {
    renderCount: renderCountRef.current,
    lastRender: new Date().toISOString(),
    isDocumentIdChanging: documentId !== prevDocumentIdRef.current,
    isStatusChanging: status !== prevStatusRef.current,
    isContentChanging: content !== prevContentRef.current,
  };

  // Update refs for next render
  prevDocumentIdRef.current = documentId;
  prevStatusRef.current = status;
  prevContentRef.current = content;

  console.log('[Canvas Debug] 🔍 Component render tracking:', renderInfo);

  console.log('[Canvas Debug] 📋 Document ID resolution:', {
    hasMetadataTaskId: !!metadata?.taskId,
    hasContent: !!content,
    contentIsJson: (() => {
      try {
        JSON.parse(content || '');
        return true;
      } catch {
        return false;
      }
    })(),
    finalDocumentId: documentId,
  });

  // Add debugging for rapid re-renders
  if (!documentId) {
    console.log(
      '[Canvas Debug] ⚠️  ISSUE: No document ID - Canvas will show initializing state',
    );
    console.log('[Canvas Debug] 🔍 Troubleshooting info:', {
      contentReceived: !!content,
      contentValue: content,
      metadataReceived: !!metadata,
      metadataContent: metadata,
      possibleCauses: [
        'Artifact content not set properly',
        'Multiple artifact initializations',
        'Document handler not returning ID',
      ],
    });
  }

  // Always call useSWR hooks unconditionally (Rules of Hooks) - BEFORE any conditional returns
  const {
    data: canvasDocument,
    isLoading: isDocumentLoading,
    mutate: mutateDocument,
  } = useSWR<Document>(
    'canvas-document', // Stable key
    async () => {
      // Handle conditional logic inside the fetcher
      if (!documentId || documentId === 'init') {
        console.log(
          '[Canvas Debug] No documentId available, skipping document fetch',
        );
        return null;
      }
      console.log('[Canvas Debug] 🔄 Fetching document with ID:', documentId);
      const doc = await fetcher(`/api/document?id=${documentId}`);
      console.log('[Canvas Debug] 📄 Document fetched:', {
        hasDoc: !!doc,
        docId: doc?.id,
        docTitle: doc?.title,
        taskIds: doc?.taskIds,
        taskIdsLength: doc?.taskIds?.length || 0,
      });

      if (doc?.taskIds?.length) {
        console.log(
          '[Canvas Debug] ✅ Document successfully found with task IDs:',
          doc.taskIds,
        );
      } else if (doc) {
        console.log('[Canvas Debug] ⚠️  Document found but no task IDs yet');
      } else {
        console.log('[Canvas Debug] ❌ Document not found');
      }

      return doc;
    },
  );

  // Always call useSWR for tasks - use dynamic key that depends on document
  const swrKey = canvasDocument?.taskIds?.length
    ? `tasks-data-${canvasDocument.id}`
    : null;
  console.log('[Canvas Debug] 📡 SWR Key for tasks:', swrKey);

  const {
    data: tasksData,
    isLoading: isTasksLoading,
    mutate: mutateTasks,
  } = useSWR<Task[]>(
    swrKey,
    async () => {
      const taskIds = canvasDocument?.taskIds || [];
      console.log('[Canvas Debug] 🔄 Task fetching started:', {
        hasCanvasDocument: !!canvasDocument,
        taskIdsFromDoc: taskIds,
        taskIdsLength: taskIds.length,
        fetchTimestamp: new Date().toISOString(),
      });

      if (taskIds.length === 0) {
        console.log(
          '[Canvas Debug] ❌ No task IDs found, returning empty array',
        );
        return [];
      }

      console.log('[Canvas Debug] 📥 Fetching tasks individually:', taskIds);

      try {
        // Fetch tasks individually and combine results
        const responses = await Promise.all(
          taskIds.map(async (taskId: string) => {
            console.log('[Canvas Debug] 📤 Fetching task:', taskId);
            const task = await fetcher(`/api/tasks/${taskId}`);
            console.log('[Canvas Debug] ✅ Task fetched:', {
              taskId: taskId,
              hasTask: !!task,
              taskTitle: task?.result?.title,
              taskStatus: task?.status,
            });
            return task;
          }),
        );

        console.log('[Canvas Debug] 🎉 All tasks fetched successfully:', {
          taskCount: responses.length,
          validTasks: responses.filter(Boolean).length,
        });

        return responses.filter(Boolean); // Filter out any null/undefined tasks
      } catch (error) {
        console.error('[Canvas Debug] ❌ Error fetching tasks:', error);
        return [];
      }
    },
    {
      // Add SWR options to prevent unwanted cache invalidations
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
    },
  );

  // Effect to handle race conditions and retry data fetching (must be before conditional returns)
  useEffect(() => {
    // If we're not loading, have a document, but no tasks, and status suggests we should have tasks
    // This can happen due to race conditions between Canvas initialization and task storage
    if (
      !isLoading &&
      !isDocumentLoading &&
      !isTasksLoading &&
      canvasDocument &&
      (!canvasDocument.taskIds || canvasDocument.taskIds.length === 0) &&
      status === 'streaming'
    ) {
      console.log(
        '[Canvas Debug] Potential race condition detected, retrying document fetch in 2 seconds...',
      );

      // Retry fetching the document after a short delay
      const retryTimer = setTimeout(() => {
        console.log('[Canvas Debug] Retrying document fetch...');
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

  // Now we can have conditional returns after all hooks are called
  if (isLoading || isDocumentLoading) {
    console.log('[Canvas Debug] Still loading...', {
      isLoading,
      isDocumentLoading,
    });
    return <DocumentSkeleton artifactKind="canvas" />;
  }

  // If no document ID is available, show a helpful message
  if (!documentId || documentId === 'init') {
    console.log('[Canvas Debug] No valid document ID available');
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

  // Recreate taskIds for later use
  const taskIds = canvasDocument?.taskIds || [];

  // Convert database tasks to UI format expected by CanvasFlow
  const uiTasks = (tasksData || []).map((task) => {
    const taskResult = (
      task.result && typeof task.result === 'object' ? task.result : {}
    ) as TaskResultData;
    console.log('[Canvas Debug] Converting task to UI:', {
      taskId: task.id,
      taskStatus: task.status,
      taskResult: taskResult,
      uiTitle: taskResult.title || `Task ${task.id.slice(-8)}`,
      uiDescription: taskResult.description || `Status: ${task.status}`,
    });

    return {
      id: task.id,
      title: taskResult.title || `Task ${task.id.slice(-8)}`,
      description: taskResult.description || `Status: ${task.status}`,
      status: transformTaskStatusToUI(task.status),
    };
  });

  // Extract actual agents from database task assignments
  const uiAgents = (tasksData || [])
    .filter((task) => {
      const taskResult = (
        task.result && typeof task.result === 'object' ? task.result : {}
      ) as TaskResultData;
      return taskResult.assignedAgent;
    })
    .map((task) => {
      const taskResult = (
        task.result && typeof task.result === 'object' ? task.result : {}
      ) as TaskResultData;
      const assignedAgent = taskResult.assignedAgent;
      if (!assignedAgent) {
        // This shouldn't happen due to the filter above, but TypeScript safety
        throw new Error(`Task ${task.id} missing assignedAgent`);
      }
      return {
        id: assignedAgent.id || `agent-${task.id}`,
        name: assignedAgent.name || `Agent for ${taskResult.title || 'Task'}`,
        description: assignedAgent.description || 'A2A Agent',
        capabilities: assignedAgent.capabilities || ['task-execution'],
        taskId: task.id,
        pricingUsdt: assignedAgent.pricingUsdt,
        walletAddress: assignedAgent.walletAddress,
        rating: assignedAgent.rating,
        completedTasks: assignedAgent.completedTasks,
      };
    });

  // Mock responses data for completed tasks
  const mockResponses = uiTasks
    .filter((task) => task.status === 'completed')
    .map((task) => ({
      id: `response-${task.id}`,
      agentId: `agent-${task.id}`,
      content: 'Task completed successfully',
      timestamp: new Date(),
    }));

  if (isTasksLoading) {
    return <DocumentSkeleton artifactKind="canvas" />;
  }

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

  // Handler for executing all agents via Python orchestrator
  const handleExecuteAllAgents = async () => {
    if (!tasksData || tasksData.length === 0) {
      toast.warning('No tasks available to execute');
      return;
    }

    toast.info(`Executing ${tasksData.length} tasks...`);

    // Execute tasks in parallel via the agent execution API
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

  // Debug logging for canvas state with timestamps to track rapid changes
  const renderState = {
    status,
    hasDocument: !!canvasDocument,
    documentId: canvasDocument?.id,
    documentTaskIds: canvasDocument?.taskIds,
    rawTasksData: tasksData,
    taskCount: uiTasks.length,
    agentCount: uiAgents.length,
    responseCount: mockResponses.length,
    isGenerating:
      status === 'streaming' && uiTasks.length === 0 && !isTasksLoading,
    isTasksLoading: isTasksLoading,
    isDocumentLoading: isDocumentLoading,
    taskIds: taskIds,
    renderTimestamp: new Date().toISOString(),
  };

  console.log('[Canvas Render] 📊 Current render state:', renderState);

  // Track task data changes
  if (uiTasks.length > 0) {
    console.log(
      '[Canvas Render] ✅ UI Tasks rendered:',
      uiTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    );
  } else {
    console.log('[Canvas Render] ⚠️  No UI tasks to display');

    // Detailed debugging when no tasks
    if (tasksData && tasksData.length > 0) {
      console.log(
        '[Canvas Render] 🔍 Raw tasks data exists but not transformed:',
        {
          rawTasksCount: tasksData.length,
          rawTasks: tasksData.map((t) => ({ id: t.id, result: t.result })),
        },
      );
    }

    if (canvasDocument?.taskIds?.length) {
      console.log(
        '[Canvas Render] 🔍 Document has task IDs but no task data:',
        {
          documentTaskIds: canvasDocument.taskIds,
          isTasksLoading: isTasksLoading,
          swrKey: swrKey,
        },
      );
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="relative size-full">
        {/* Show debug info in development */}
        {process.env.NODE_ENV === 'development' && (
          <div className="absolute top-0 right-0 z-50 bg-black/80 text-white text-xs p-2 rounded-bl">
            Tasks: {uiTasks.length} | Agents: {uiAgents.length} | Status:{' '}
            {status}
          </div>
        )}
        <CanvasFlow
          tasks={uiTasks}
          agents={uiAgents}
          responses={mockResponses}
          summary={null} // TODO: Implement summary from database
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

interface CanvasArtifactMetadata {
  taskId?: string; // The task ID from Python agent (for execution)
  suggestions: Array<Suggestion>;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in-progress' | 'completed' | 'recruiting';
  }>;
  agents: Array<{
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    taskId?: string;
    pricingUsdt?: number;
    walletAddress?: string;
  }>;
  responses: Array<{
    id: string;
    agentId: string;
    content: string;
    timestamp: Date;
  }>;
  summary: {
    id: string;
    content: string;
    timestamp: Date;
  } | null;
  isInitialDataLoaded?: boolean; // New flag to prevent re-processing loaded data
}

export const canvasArtifact = new Artifact<'canvas', CanvasArtifactMetadata>({
  kind: 'canvas',
  description:
    'Interactive canvas for task decomposition and agent coordination.',
  initialize: async ({ documentId, setMetadata }) => {
    console.log('[Canvas Artifact] 🚀 Initializing Canvas artifact:', {
      documentId: documentId,
      initTimestamp: new Date().toISOString(),
    });

    // Skip suggestions for canvas - they're not used in the A2A task workflow
    // and were causing database errors during initialization
    setMetadata({
      taskId: undefined, // Will be set when task is created
      suggestions: [], // Empty array - suggestions not needed for canvas
      tasks: [],
      agents: [],
      responses: [],
      summary: null,
      isInitialDataLoaded: false, // Initialize the flag
    });

    console.log('[Canvas Artifact] ✅ Canvas artifact metadata initialized');
  },
  onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
    // Handle suggestions if they come through (optional, with error handling)
    if (streamPart.type === 'data-suggestion') {
      try {
        setMetadata((metadata) => {
          return {
            ...metadata,
            suggestions: [...(metadata.suggestions || []), streamPart.data],
          };
        });
      } catch (error) {
        console.warn('Error handling suggestion stream part:', error);
        // Continue without suggestions - they're not essential for canvas
      }
    }

    if (streamPart.type === 'data-textDelta') {
      setArtifact((draftArtifact) => {
        // Parse streamed data from Python agent with enhanced error handling
        try {
          if (!streamPart.data || typeof streamPart.data !== 'string') {
            console.warn('Invalid stream data received:', streamPart.data);
            return draftArtifact;
          }

          const parsedData = JSON.parse(streamPart.data);
          console.log('[Canvas] Processing streamed data:', parsedData);

          // Handle new job with pre-assigned agent (jobs within a task)
          if (parsedData.newJob) {
            console.log('Received job with agent:', parsedData.newJob.title);
            if (parsedData.taskId) {
              console.log('Setting taskId in metadata:', parsedData.taskId);
            } else {
              console.warn(
                'No taskId in parsedData for job:',
                parsedData.newJob.title,
              );
            }

            // Use functional update to prevent race conditions
            setMetadata((prevMetadata) => {
              const currentTasks = prevMetadata?.tasks || [];
              const currentAgents = prevMetadata?.agents || [];

              // Check if job already exists to prevent duplicates
              if (
                currentTasks.some((task) => task.id === parsedData.newJob.id)
              ) {
                console.log(
                  'Job already exists, skipping:',
                  parsedData.newJob.title,
                );
                return prevMetadata;
              }

              console.log(
                `Adding job ${currentTasks.length + 1}: ${parsedData.newJob.title}`,
              );

              return {
                ...prevMetadata,
                taskId: parsedData.taskId || prevMetadata?.taskId, // Set or preserve taskId
                tasks: [...currentTasks, parsedData.newJob], // UI uses 'tasks' for jobs
                // Add agent if job has one assigned
                agents: parsedData.newJob.assignedAgent
                  ? [
                      ...currentAgents,
                      {
                        ...parsedData.newJob.assignedAgent,
                        taskId: parsedData.newJob.id,
                      },
                    ]
                  : currentAgents,
              };
            });
          }
          // Handle job response from agent execution (both legacy and standardized formats)
          else if (
            parsedData.jobResponse ||
            (parsedData.type === 'job-update' && parsedData.data)
          ) {
            const jobData = parsedData.jobResponse || parsedData.data;
            console.log('Received job response:', jobData.agentId);
            setMetadata((metadata) => ({
              ...metadata,
              taskId: metadata?.taskId, // Preserve taskId
              responses: [
                ...(metadata?.responses || []),
                {
                  ...jobData,
                  timestamp: new Date(jobData.timestamp),
                },
              ],
              // Update job status if needed
              tasks: (metadata?.tasks || []).map((job) => {
                return job.id === jobData.jobId
                  ? { ...job, status: jobData.status || ('completed' as const) }
                  : job;
              }),
            }));
          }
          // Handle summary (both legacy and standardized formats)
          else if (
            parsedData.summary ||
            (parsedData.type === 'summary-update' && parsedData.data)
          ) {
            const summaryData = parsedData.summary || parsedData.data;
            console.log('Received summary update');
            setMetadata((metadata) => ({
              ...metadata,
              taskId: metadata?.taskId, // Preserve taskId
              summary: {
                ...summaryData,
                timestamp: new Date(summaryData.timestamp),
              },
            }));
          }
          // Handle job completion confirmation from createTask
          else if (parsedData.type === 'jobs-completed') {
            console.log(
              `All ${parsedData.totalJobs} jobs completed for task ${parsedData.taskId}`,
            );

            // Validate that all jobs were received
            setMetadata((prevMetadata) => {
              const currentTasks = prevMetadata?.tasks || [];
              const expectedCount = parsedData.totalJobs;
              const actualCount = currentTasks.length;

              if (actualCount !== expectedCount) {
                console.error(
                  `Job count mismatch! Expected: ${expectedCount}, Actual: ${actualCount}`,
                );
                console.error(
                  'Current tasks:',
                  currentTasks.map((t) => t.title),
                );

                // Could trigger a retry mechanism here if needed
                toast.error(
                  `Job streaming incomplete: ${actualCount}/${expectedCount} jobs received`,
                );
              } else {
                console.log(
                  `✅ All ${actualCount} jobs successfully received and processed`,
                );
                toast.success(`Canvas ready: ${actualCount} jobs loaded`);
              }

              return prevMetadata;
            });
          }
          // Handle canvas ready status
          else if (parsedData.status === 'canvas-ready') {
            console.log('[Canvas] Canvas ready:', parsedData.message);
            toast.success(parsedData.message || 'Canvas created successfully');

            // Set basic taskId if available
            if (parsedData.canvasId) {
              setMetadata((metadata) => ({
                ...metadata,
                taskId: parsedData.canvasId,
              }));
            }
          }
          // Handle canvas tasks linked notification
          else if (parsedData.type === 'canvas-tasks-linked') {
            console.log('[Canvas] Tasks linked to canvas:', parsedData);
            toast.success(
              parsedData.message ||
                `Canvas updated with ${parsedData.taskCount} tasks`,
            );

            // The document should now have taskIds, so we don't need to do anything here
            // The Canvas component will automatically refetch when it detects the document has taskIds
          }
          // Handle complete data structure
          else if (parsedData.tasks) {
            console.log(
              'Received complete data with',
              parsedData.tasks.length,
              'tasks',
            );
            setMetadata((metadata) => ({
              ...metadata,
              taskId: metadata?.taskId, // Preserve taskId
              tasks: parsedData.tasks,
              agents: parsedData.agents || [],
              responses: parsedData.responses || [],
              summary: parsedData.summary || null,
            }));
          }
          // Handle loading saved data from server
          else if (parsedData.type === 'load-saved-data') {
            setMetadata((currentMetadata) => {
              if (currentMetadata?.isInitialDataLoaded) {
                console.log('[Canvas] Initial data already loaded, skipping.');
                return currentMetadata;
              }

              console.log('[Canvas] Loading saved data from server:', {
                taskId: parsedData.taskId,
                taskCount: parsedData.tasks?.length || 0,
                agentCount: parsedData.agents?.length || 0,
                responseCount: parsedData.responses?.length || 0,
                hasSummary: !!parsedData.summary,
              });

              // Convert timestamps back to Date objects
              const responses = (parsedData.responses || []).map(
                (response: any) => ({
                  ...response,
                  timestamp: new Date(response.timestamp),
                }),
              );

              const summary = parsedData.summary
                ? {
                    ...parsedData.summary,
                    timestamp: new Date(parsedData.summary.timestamp),
                  }
                : null;

              return {
                ...currentMetadata,
                taskId: parsedData.taskId || currentMetadata?.taskId,
                tasks: parsedData.tasks || [],
                agents: parsedData.agents || [],
                responses,
                summary,
                isInitialDataLoaded: true, // Mark as loaded
              };
            });
          }
        } catch (error) {
          // Not JSON, likely streaming text - log for debugging but don't break
          console.log(
            '[Canvas] Non-JSON data received (normal for text streams):',
            streamPart.data?.substring(0, 100),
          );
        }

        return {
          ...draftArtifact,
          // Don't set content for canvas - it uses metadata instead
          status: 'streaming',
        };
      });
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
    metadata,
  }) => {
    console.log('[Canvas Artifact] 🎨 Content function called:', {
      mode,
      status,
      content,
      contentType: typeof content,
      contentLength: content?.length || 0,
      isCurrentVersion,
      currentVersionIndex,
      isLoading,
      hasMetadata: !!metadata,
      contentTimestamp: new Date().toISOString(),
    });

    return (
      <CanvasContent
        mode={mode}
        status={status}
        content={content}
        isCurrentVersion={isCurrentVersion}
        currentVersionIndex={currentVersionIndex}
        onSaveContent={onSaveContent}
        getDocumentContentById={getDocumentContentById}
        isLoading={isLoading}
        metadata={metadata}
      />
    );
  },
  actions: [
    {
      icon: <ClockRewind size={18} />,
      description: 'View changes',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('toggle');
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      },
    },
    {
      icon: <UndoIcon size={18} />,
      description: 'View Previous version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('prev');
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      },
    },
    {
      icon: <RedoIcon size={18} />,
      description: 'View Next version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('next');
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }
        return false;
      },
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
