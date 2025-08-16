import { Artifact } from '@/components/create-artifact';
import { CanvasFlow } from '../../components/canvas-flow';
import { DocumentSkeleton } from '@/components/document-skeleton';
import { useEffect } from 'react';
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
import { getSuggestions } from '../actions';

// Configuration constants
const CONFIG = {
  STREAMING: {
    RESPONSE_INTERVAL: 30,  // ms between characters
    SUMMARY_INTERVAL: 20,   // ms between characters
    AGENT_STAGGER_DELAY: 200, // ms between agent starts
  },
  AGENT: {
    NAME_MAX_LENGTH: 15,
    NAME_TRUNCATE_LENGTH: 12,
  },
} as const;

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
  description: 'Interactive canvas for task decomposition and agent coordination.',
  initialize: async ({ documentId, setMetadata }) => {
    const suggestions = await getSuggestions({ documentId });

    setMetadata({
      taskId: undefined, // Will be set when task is created
      suggestions,
      tasks: [],
      agents: [],
      responses: [],
      summary: null,
    });
  },
  onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
    if (streamPart.type === 'data-suggestion') {
      setMetadata((metadata) => {
        return {
          ...metadata,
          suggestions: [...metadata.suggestions, streamPart.data],
        };
      });
    }


    if (streamPart.type === 'data-textDelta') {
      setArtifact((draftArtifact) => {
        // Parse streamed data from Python agent
        try {
          const parsedData = JSON.parse(streamPart.data);
          
          // Handle new job with pre-assigned agent (jobs within a task)
          if (parsedData.newJob) {
            console.log('Received job with agent:', parsedData.newJob.title);
            if (parsedData.taskId) {
              console.log('Setting taskId in metadata:', parsedData.taskId);
            } else {
              console.warn('No taskId in parsedData for job:', parsedData.newJob.title);
            }
            setMetadata((metadata) => ({
              ...metadata,
              taskId: parsedData.taskId || metadata?.taskId, // Set or preserve taskId
              tasks: [...(metadata?.tasks || []), parsedData.newJob], // UI uses 'tasks' for jobs
              // Add agent if job has one assigned
              agents: parsedData.newJob.assignedAgent 
                ? [...(metadata?.agents || []), { ...parsedData.newJob.assignedAgent, taskId: parsedData.newJob.id }]
                : metadata?.agents || [],
            }));
          }
          // Handle job response from agent execution
          else if (parsedData.jobResponse) {
            console.log('Received job response:', parsedData.jobResponse.agentId);
            setMetadata((metadata) => ({
              ...metadata,
              taskId: metadata?.taskId, // Preserve taskId
              responses: [...(metadata?.responses || []), {
                ...parsedData.jobResponse,
                timestamp: new Date(parsedData.jobResponse.timestamp),
              }],
              // Update job status if needed
              tasks: (metadata?.tasks || []).map(job => {
                return job.id === parsedData.jobResponse.jobId
                  ? { ...job, status: parsedData.jobResponse.status || 'completed' as const }
                  : job;
              }),
            }));
          }
          // Handle summary
          else if (parsedData.summary) {
            console.log('Received summary');
            setMetadata((metadata) => ({
              ...metadata,
              taskId: metadata?.taskId, // Preserve taskId
              summary: {
                ...parsedData.summary,
                timestamp: new Date(parsedData.summary.timestamp),
              },
            }));
          }
          // Handle complete data structure
          else if (parsedData.tasks) {
            console.log('Received complete data with', parsedData.tasks.length, 'tasks');
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
          // Not JSON, likely streaming text - ignore
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
    // Load saved canvas data when opened
    useEffect(() => {
      if (content && (!metadata?.tasks || metadata.tasks.length === 0)) {
        try {
          const parsedData = JSON.parse(content);
          if (parsedData.tasks) {
            console.log('Loading saved canvas data');
            
            // Convert timestamps back to Date objects
            const responses = (parsedData.responses || []).map((response: any) => ({
              ...response,
              timestamp: new Date(response.timestamp)
            }));
            
            const summary = parsedData.summary ? {
              ...parsedData.summary,
              timestamp: new Date(parsedData.summary.timestamp)
            } : null;
            
            setMetadata((metadata) => ({
              ...metadata,
              taskId: metadata?.taskId, // Preserve taskId
              tasks: parsedData.tasks,
              agents: parsedData.agents || [],
              responses,
              summary,
            }));
          }
        } catch (error) {
          console.error('Failed to parse canvas data:', error);
        }
      }
    }, [content, metadata, setMetadata]);

    // Save changes to document
    useEffect(() => {
      if (metadata?.tasks && metadata.tasks.length > 0 && onSaveContent) {
        const dataToSave = {
          tasks: metadata.tasks,
          agents: metadata.agents || [],
          responses: metadata.responses || [],
          summary: metadata.summary || null,
        };
        
        const contentToSave = JSON.stringify(dataToSave, null, 2);
        
        if (contentToSave !== content) {
          console.log('Saving canvas changes');
          onSaveContent(contentToSave, true);
        }
      }
    }, [metadata, onSaveContent, content]);

    if (isLoading) {
      return <DocumentSkeleton artifactKind="canvas" />;
    }

    if (mode === 'diff') {
      const oldContent = getDocumentContentById(currentVersionIndex - 1);
      const newContent = getDocumentContentById(currentVersionIndex);

      return (
        <div className="flex flex-col py-8 md:p-20 px-4">
          <div className="text-sm text-muted-foreground mb-4">Canvas diff view not available</div>
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
        tasks: (metadata?.tasks || []).map(task => ({
          ...task,
          status: 'in-progress' as const
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
                
                // Handle different event types
                if (data.type === 'execution-started') {
                  console.log('Execution started:', data.message);
                } else if (data.type === 'job-update') {
                  // Update job status
                  console.log('Job update:', data.data);
                  setMetadata((metadata) => ({
                    ...metadata,
                    taskId: metadata?.taskId, // Preserve taskId
                    responses: [...(metadata?.responses || []), {
                      ...data.data,
                      timestamp: new Date(data.data.timestamp),
                    }],
                    tasks: (metadata?.tasks || []).map(job => 
                      job.id === data.data.jobId
                        ? { ...job, status: data.data.status || 'completed' as const }
                        : job
                    ),
                  }));
                } else if (data.type === 'summary-update') {
                  // Update summary
                  console.log('Summary update:', data.data);
                  setMetadata((metadata) => ({
                    ...metadata,
                    taskId: metadata?.taskId, // Preserve taskId
                    summary: {
                      ...data.data,
                      timestamp: new Date(data.data.timestamp),
                    },
                  }));
                } else if (data.type === 'execution-completed') {
                  toast.success('Agent execution completed successfully');
                } else if (data.type === 'execution-error') {
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
          tasks: (metadata?.tasks || []).map(task => ({
            ...task,
            status: 'pending' as const
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

    return (
      <div className="flex flex-col h-full">
        <div className="relative w-full h-full">
          <CanvasFlow 
            tasks={metadata?.tasks || []}
            agents={metadata?.agents || []}
            responses={metadata?.responses || []}
            summary={metadata?.summary || null}
            onExecuteAllAgents={handleExecuteAllAgents}
            onSummarize={handleSummarize}
            isGenerating={status === 'streaming' && (!metadata?.tasks || metadata.tasks.length === 0)}
            allAgentsExecuted={(metadata?.agents || []).every(agent => 
              (metadata?.responses || []).some(r => r.agentId === agent.id)
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