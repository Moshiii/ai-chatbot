import { Artifact } from '@/components/create-artifact';
import { CanvasFlow } from '../../components/canvas-flow';
import { DocumentSkeleton } from '@/components/document-skeleton';

import {
  ClockRewind,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons';
import type { Suggestion } from '@/lib/db/schema';
import { toast } from 'sonner';

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
}

export const canvasArtifact = new Artifact<'canvas', CanvasArtifactMetadata>({
  kind: 'canvas',
  description:
    'Interactive canvas for task decomposition and agent coordination.',
  initialize: async ({ documentId, setMetadata }) => {
    // Skip suggestions for canvas - they're not used in the A2A task workflow
    // and were causing database errors during initialization
    setMetadata({
      taskId: undefined, // Will be set when task is created
      suggestions: [], // Empty array - suggestions not needed for canvas
      tasks: [],
      agents: [],
      responses: [],
      summary: null,
    });
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
        } catch (error) {
          // Not JSON, likely streaming text - log for debugging but don't break
          console.log(
            '[Canvas] Non-JSON data received (normal for text streams):',
            streamPart.data?.substring(0, 100),
          );
        }

        return {
          ...draftArtifact,
          content: streamPart.data,
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
    setMetadata,
  }) => {
    // Load saved canvas data when opened (simplified without useEffect)
    if (content && (!metadata?.tasks || metadata.tasks.length === 0)) {
      try {
        const parsedData = JSON.parse(content);
        if (parsedData.tasks) {
          console.log('Loading saved canvas data:', {
            taskId: parsedData.taskId,
            taskCount: parsedData.tasks.length,
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

          setMetadata((metadata) => ({
            ...metadata,
            taskId: parsedData.taskId || metadata?.taskId, // ✅ Load saved taskId or preserve current
            tasks: parsedData.tasks,
            agents: parsedData.agents || [],
            responses,
            summary,
          }));
        } else {
          console.log(
            'No tasks found in saved content, content:',
            content?.substring(0, 100),
          );
        }
      } catch (error) {
        console.error('Failed to parse canvas data:', error);
      }
    }

    // Auto-save changes when metadata changes (simplified without useEffect)
    if (metadata?.tasks && metadata.tasks.length > 0 && onSaveContent) {
      const dataToSave = {
        taskId: metadata.taskId, // ✅ Include taskId in saved data
        tasks: metadata.tasks,
        agents: metadata.agents || [],
        responses: metadata.responses || [],
        summary: metadata.summary || null,
      };

      const contentToSave = JSON.stringify(dataToSave, null, 2);

      if (contentToSave !== content) {
        console.log('Saving canvas changes with taskId:', metadata.taskId);
        onSaveContent(contentToSave, true);
      }
    }

    if (isLoading) {
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
      const agents = metadata?.agents || [];

      console.log('Execute clicked - Current metadata:', metadata);
      console.log('TaskId in metadata:', metadata?.taskId);

      if (!agents.length) {
        toast.warning('No agents available to execute');
        return;
      }

      // Get taskId from metadata (set when task was created)
      const taskId = metadata?.taskId;

      if (!taskId) {
        console.error('No taskId found in metadata:', metadata);
        toast.error('No task ID found. Please create a task first.');
        return;
      }

      toast.info(`Executing ${agents.length} agents...`);

      // Update all jobs to in-progress when execution starts
      setMetadata((metadata) => ({
        ...metadata,
        tasks: (metadata?.tasks || []).map((task) => ({
          ...task,
          status: 'in-progress' as const,
        })),
      }));

      try {
        // Call API endpoint with taskId
        const response = await fetch('/api/agent/execution', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskId,
            executionMode: 'parallel',
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(error || response.statusText);
        }

        // The API returns an SSE stream
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('No response stream available');
        }

        // Process the SSE stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const eventType =
                  typeof data.type === 'string'
                    ? data.type.replace(/^data-/, '')
                    : '';

                // Handle different event types
                if (eventType === 'execution-started') {
                  console.log('Execution started:', data.message);
                } else if (
                  eventType === 'job-update' ||
                  data.type === 'job-update'
                ) {
                  // Handle both old and new job-update formats
                  const jobData = data.data || data;
                  console.log('Job update:', jobData);
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
                    tasks: (metadata?.tasks || []).map((job) =>
                      job.id === jobData.jobId
                        ? {
                            ...job,
                            status: jobData.status || ('completed' as const),
                          }
                        : job,
                    ),
                  }));
                } else if (
                  eventType === 'summary-update' ||
                  data.type === 'summary-update'
                ) {
                  // Handle both old and new summary-update formats
                  const summaryData = data.data || data;
                  console.log('Summary update:', summaryData);
                  setMetadata((metadata) => ({
                    ...metadata,
                    taskId: metadata?.taskId, // Preserve taskId
                    summary: {
                      ...summaryData,
                      timestamp: new Date(summaryData.timestamp),
                    },
                  }));
                } else if (eventType === 'execution-completed') {
                  toast.success('Agent execution completed successfully');
                } else if (eventType === 'execution-error') {
                  throw new Error(data.error);
                }
              } catch (parseError) {
                console.error('Error parsing SSE data:', parseError);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error executing agents:', error);
        toast.error('Failed to execute agents');

        // Revert job statuses on error
        setMetadata((metadata) => ({
          ...metadata,
          tasks: (metadata?.tasks || []).map((task) => ({
            ...task,
            status: 'pending' as const,
          })),
        }));
      }
    };

    // Handler for summary generation
    const handleSummarize = () => {
      const responses = metadata?.responses || [];
      if (responses.length === 0) {
        toast.warning('No agent responses available to summarize');
        return;
      }

      if (metadata?.summary) {
        toast.info('Summary already exists');
        return;
      }

      toast.info('Requesting summary from orchestrator...');
      // Python agent will generate and stream the summary
    };

    // Debug logging for canvas state
    console.log('[Canvas Render] Current state:', {
      status,
      hasMetadata: !!metadata,
      taskCount: metadata?.tasks?.length || 0,
      agentCount: metadata?.agents?.length || 0,
      responseCount: metadata?.responses?.length || 0,
      isGenerating:
        status === 'streaming' &&
        (!metadata?.tasks || metadata.tasks.length === 0),
    });

    return (
      <div className="flex flex-col h-full">
        <div className="relative size-full">
          {/* Show debug info in development */}
          {process.env.NODE_ENV === 'development' && (
            <div className="absolute top-0 right-0 z-50 bg-black/80 text-white text-xs p-2 rounded-bl">
              Tasks: {metadata?.tasks?.length || 0} | Agents:{' '}
              {metadata?.agents?.length || 0} | Status: {status}
            </div>
          )}
          <CanvasFlow
            tasks={metadata?.tasks || []}
            agents={metadata?.agents || []}
            responses={metadata?.responses || []}
            summary={metadata?.summary || null}
            onExecuteAllAgents={handleExecuteAllAgents}
            onSummarize={handleSummarize}
            isGenerating={
              status === 'streaming' &&
              (!metadata?.tasks || metadata.tasks.length === 0)
            }
            allAgentsExecuted={(metadata?.agents || []).every((agent) =>
              (metadata?.responses || []).some((r) => r.agentId === agent.id),
            )}
          />
        </div>
      </div>
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
