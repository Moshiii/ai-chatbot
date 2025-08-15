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
import { generateUUID } from '@/lib/utils';

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
          
          // Handle new task with pre-assigned agent
          if (parsedData.newTask) {
            console.log('Received task with agent:', parsedData.newTask.title);
            setMetadata((metadata) => ({
              ...metadata,
              tasks: [...(metadata?.tasks || []), parsedData.newTask],
              // Add agent if task has one assigned
              agents: parsedData.newTask.assignedAgent 
                ? [...(metadata?.agents || []), { ...parsedData.newTask.assignedAgent, taskId: parsedData.newTask.id }]
                : metadata?.agents || [],
            }));
          }
          // Handle agent response
          else if (parsedData.agentResponse) {
            console.log('Received agent response:', parsedData.agentResponse.agentId);
            setMetadata((metadata) => ({
              ...metadata,
              responses: [...(metadata?.responses || []), {
                ...parsedData.agentResponse,
                timestamp: new Date(parsedData.agentResponse.timestamp),
              }],
              // Update task status if needed
              tasks: (metadata?.tasks || []).map(task => {
                const agent = metadata?.agents.find(a => a.id === parsedData.agentResponse.agentId);
                return agent?.taskId === task.id 
                  ? { ...task, status: parsedData.agentResponse.status === 'completed' ? 'completed' : 'in-progress' as const }
                  : task;
              }),
            }));
          }
          // Handle summary
          else if (parsedData.summary) {
            console.log('Received summary');
            setMetadata((metadata) => ({
              ...metadata,
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

    // Handler for agent selection - no longer needed, agents come pre-assigned
    const handleRequestAgentSelection = async (taskDescription: string, taskId?: string) => {
      toast.info('Agents are automatically assigned by the system');
    };

    // Handler for individual agent execution - deprecated
    const handleExecuteAgent = (agentId: string) => {
      console.log('Individual agent execution is deprecated');
    };

    // Handler for executing all agents via Python orchestrator
    const handleExecuteAllAgents = async () => {
      const agents = metadata?.agents || [];
      
      if (!agents.length) {
        toast.warning('No agents available to execute');
        return;
      }

      toast.info(`Executing ${agents.length} agents via orchestrator...`);

      // Update all tasks to in-progress
      setMetadata((metadata) => ({
        ...metadata,
        tasks: (metadata?.tasks || []).map(task => ({
          ...task,
          status: 'in-progress' as const
        })),
      }));

      // Python agent will handle execution and stream back responses
      // This is just a placeholder for the UI interaction
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
            onExecuteAgent={handleExecuteAgent}
            onExecuteAllAgents={handleExecuteAllAgents}
            onSummarize={handleSummarize}
            onRequestAgentSelection={handleRequestAgentSelection}
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