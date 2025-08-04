import { Artifact } from '@/components/create-artifact';
import { CanvasFlow } from '../../components/canvas-flow';
import { DocumentSkeleton } from '@/components/document-skeleton';
import { useEffect, useRef } from 'react';
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

// Function to request agent selection from server
const requestAgentSelection = async (taskDescription: string) => {
  try {
    const response = await fetch('/api/agent-selection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskDescription }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const agentData = await response.json();
    return agentData;
  } catch (error) {
    console.error('Failed to request agent selection:', error);
    throw error;
  }
};

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
    taskId?: string; // Associate agent with specific task
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
  testNodes: Array<{
    id: string;
    label: string;
    color: string;
    position: { x: number; y: number };
  }>;
  testEdges: Array<{
    id: string;
    source: string;
    target: string;
    color: string;
  }>;
}

export const canvasArtifact = new Artifact<'canvas', CanvasArtifactMetadata>({
  kind: 'canvas',
  description: 'Interactive canvas for task decomposition and agent coordination.',
  initialize: async ({ documentId, setMetadata }) => {
    const suggestions = await getSuggestions({ documentId });

    // Tasks will be loaded from the server-generated content
    // Agents will be created on-demand via the API

    setMetadata({
      suggestions,
      tasks: [],
      agents: [],
      responses: [],
      summary: null,
      testNodes: [],
      testEdges: [],
    });

    // Tasks and agents will be loaded from server content and API calls

    // Add test nodes and edges with streaming simulation
    const testNodes = [
      {
        id: 'test-node-1',
        label: 'Test Node 1',
        color: 'red',
        position: { x: 50, y: 400 },
      },
      {
        id: 'test-node-2',
        label: 'Test Node 2',
        color: 'blue',
        position: { x: 200, y: 400 },
      },
      {
        id: 'test-node-3',
        label: 'Test Node 3',
        color: 'green',
        position: { x: 350, y: 400 },
      },
    ];

    const testEdges = [
      {
        id: 'test-edge-1',
        source: 'test-node-1',
        target: 'test-node-2',
        color: 'purple',
      },
      {
        id: 'test-edge-2',
        source: 'test-node-2',
        target: 'test-node-3',
        color: 'orange',
      },
    ];

    // Stream test nodes
    setTimeout(() => {
      setMetadata((metadata) => ({
        ...metadata,
        testNodes: [testNodes[0]],
      }));
    }, 4000);

    setTimeout(() => {
      setMetadata((metadata) => ({
        ...metadata,
        testNodes: [testNodes[0], testNodes[1]],
      }));
    }, 4500);

    setTimeout(() => {
      setMetadata((metadata) => ({
        ...metadata,
        testNodes: testNodes,
        testEdges: [testEdges[0]],
      }));
    }, 5000);

    setTimeout(() => {
      setMetadata((metadata) => ({
        ...metadata,
        testEdges: testEdges,
      }));
    }, 5500);
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
        // Try to parse the streamed content as JSON
        try {
          const parsedData = JSON.parse(streamPart.data);
          
          // Handle incremental task streaming
          if (parsedData.newTask) {
            console.log('Received new task:', parsedData.newTask.title);
            setMetadata((metadata) => ({
              ...metadata,
              tasks: [...(metadata?.tasks || []), parsedData.newTask],
            }));
          }
          // Handle complete data structure (fallback)
          else if (parsedData.tasks) {
            console.log('Received complete data with', parsedData.tasks.length, 'tasks');
            setMetadata((metadata) => ({
              ...metadata,
              tasks: parsedData.tasks,
              agents: parsedData.agents || [],
            }));
          }
        } catch (error) {
          // If parsing fails, it's not complete JSON yet, which is normal during streaming
          console.log('Failed to parse streamed data:', error);
        }

        return {
          ...draftArtifact,
          content: streamPart.data,
          status: 'streaming',
          // Make canvas visible when it starts receiving data
          isVisible: true,
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
    // Load initial canvas data when the artifact is opened
    useEffect(() => {
      if (content && (!metadata?.tasks || metadata.tasks.length === 0)) {
        try {
          const parsedData = JSON.parse(content);
          if (parsedData.tasks) {
            setMetadata((metadata) => ({
              ...metadata,
              tasks: parsedData.tasks,
              agents: parsedData.agents || [],
            }));
          }
        } catch (error) {
          console.error('Failed to parse canvas data:', error);
        }
      }
    }, [content, metadata, setMetadata]);

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

    const handleRequestAgentSelection = async (taskDescription: string, taskId?: string) => {
      try {
        // Update task status to recruiting when agent request starts
        if (taskId) {
          setMetadata((metadata) => ({
            ...metadata,
            tasks: (metadata?.tasks || []).map(task => 
              task.id === taskId 
                ? { ...task, status: 'recruiting' as const }
                : task
            ),
          }));
        }

        const agentData = await requestAgentSelection(taskDescription);
        
        // Generate a unique ID for the agent to prevent duplicates
        const uniqueAgentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Ensure agent name is not longer than 15 characters to prevent UI overflow
        const truncatedAgentName = agentData.name.length > 15 
          ? agentData.name.substring(0, 12) + '...' 
          : agentData.name;
        
        const agentWithUniqueId = { ...agentData, id: uniqueAgentId, name: truncatedAgentName };
        
        // Associate the agent with the task if taskId is provided
        const agentWithTaskId = taskId ? { ...agentWithUniqueId, taskId } : agentWithUniqueId;
        
        // Add the new agent to the metadata and update task status back to pending
        setMetadata((metadata) => ({
          ...metadata,
          agents: [...(metadata?.agents || []), agentWithTaskId],
          tasks: (metadata?.tasks || []).map(task => 
            task.id === taskId 
              ? { ...task, status: 'pending' as const }
              : task
          ),
        }));
        

      } catch (error) {
        console.error('Failed to request agent selection:', error);
        toast.error('Failed to create agent. Please try again.');
        
        // Reset task status back to pending if agent creation fails
        if (taskId) {
          setMetadata((metadata) => ({
            ...metadata,
            tasks: (metadata?.tasks || []).map(task => 
              task.id === taskId 
                ? { ...task, status: 'pending' as const }
                : task
            ),
          }));
        }
      }
    };



    const handleExecuteAgent = (agentId: string) => {
      const agent = metadata?.agents.find(a => a.id === agentId);
      if (!agent || !setMetadata) return;

      // Check if agent already has a response
      const existingResponse = metadata?.responses.find(r => r.agentId === agentId);
      if (existingResponse) {
        toast.info(`${agent.name} has already been executed`);
        return;
      }

      // Update task status to in-progress if agent is associated with a task
      if (agent.taskId) {
        setMetadata((metadata) => ({
          ...metadata,
          tasks: (metadata?.tasks || []).map(task => 
            task.id === agent.taskId 
              ? { ...task, status: 'in-progress' as const }
              : task
          ),
        }));
      }

      // Create response with streaming content
      const responseId = `response-${agentId}-${Date.now()}`;
      const initialResponse = {
        id: responseId,
        agentId,
        content: '',
        timestamp: new Date(),
      };
      
      setMetadata((metadata) => ({
        ...metadata,
        responses: [...(metadata?.responses || []), initialResponse],
      }));

      // Generate realistic response content based on agent type
      const generateResponseContent = (agentName: string, capabilities: string[]) => {
        const baseContent = `${agentName} execution completed successfully. `;
        
        if (capabilities.includes('Web Scraping')) {
          return baseContent + `Collected data from 15 different sources including APIs, databases, and web pages. Found 2,847 relevant data points with 98% accuracy. Data has been validated and stored in the central repository.`;
        } else if (capabilities.includes('Statistical Analysis')) {
          return baseContent + `Processed 2,847 data points through statistical analysis pipeline. Identified 12 significant correlations and 3 outlier patterns. Generated 8 visualization charts and statistical reports.`;
        } else if (capabilities.includes('ML Algorithms')) {
          return baseContent + `Applied machine learning algorithms to detect patterns. Achieved 94% accuracy in pattern recognition. Identified 7 key trends and 2 anomaly clusters. Model performance validated with cross-validation.`;
        } else if (capabilities.includes('Report Writing')) {
          return baseContent + `Synthesized all findings into comprehensive report. Created executive summary, detailed analysis, and actionable recommendations. Report includes 15 visualizations and 8 appendices.`;
        }
        
        return baseContent + `Task completed with high efficiency. All objectives met within specified parameters.`;
      };

      const responseContent = generateResponseContent(agent.name, agent.capabilities);
      
      // Simulate streaming response content
      let currentContent = '';
      const streamInterval = setInterval(() => {
        if (currentContent.length < responseContent.length) {
          currentContent += responseContent[currentContent.length];
          
          setMetadata((metadata) => ({
            ...metadata,
            responses: (metadata?.responses || []).map(r => 
              r.id === responseId 
                ? { ...r, content: currentContent }
                : r
            ),
          }));
        } else {
          clearInterval(streamInterval);
          
          // Update task status to completed if agent is associated with a task
          if (agent.taskId) {
            setMetadata((metadata) => ({
              ...metadata,
              tasks: (metadata?.tasks || []).map(task => 
                task.id === agent.taskId 
                  ? { ...task, status: 'completed' as const }
                  : task
              ),
            }));
          }
          

        }
      }, 30);
    };

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

      if (!setMetadata) return;

      // Create summary with streaming content
      const summaryId = `summary-${Date.now()}`;
      const initialSummary = {
        id: summaryId,
        content: '',
        timestamp: new Date(),
      };
      
      setMetadata((metadata) => ({
        ...metadata,
        summary: initialSummary,
      }));

      // Generate comprehensive summary based on all responses
      const generateSummaryContent = (responses: typeof metadata.responses) => {
        const agentNames = responses.map(r => {
          const agent = metadata?.agents.find(a => a.id === r.agentId);
          return agent?.name || 'Unknown Agent';
        });

        const completedTasks = metadata?.tasks.filter(t => t.status === 'completed').length || 0;
        const totalTasks = metadata?.tasks.length || 0;

        return `Executive Summary Report

Project Status: ${completedTasks}/${totalTasks} tasks completed (${Math.round((completedTasks/totalTasks)*100)}%)

Key Findings:
• ${responses.length} agents successfully executed their assigned tasks
• Data collection phase gathered 2,847 data points with 98% accuracy
• Statistical analysis identified 12 significant correlations and 3 outlier patterns
• Machine learning algorithms achieved 94% accuracy in pattern recognition
• Comprehensive report generated with 15 visualizations and 8 appendices

Recommendations:
1. Proceed with implementation of identified patterns
2. Investigate the 3 outlier patterns for potential insights
3. Consider expanding data collection to include additional sources
4. Schedule follow-up analysis in 30 days to track pattern evolution

Next Steps:
• Review detailed findings in individual agent reports
• Present findings to stakeholders
• Begin implementation planning phase

Generated by: ${agentNames.join(', ')}
Timestamp: ${new Date().toLocaleString()}`;
      };

      const summaryContent = generateSummaryContent(responses);
      
      // Simulate streaming summary content
      let currentContent = '';
      const streamInterval = setInterval(() => {
        if (currentContent.length < summaryContent.length) {
          currentContent += summaryContent[currentContent.length];
          
          setMetadata((metadata) => ({
            ...metadata,
            summary: metadata?.summary ? {
              ...metadata.summary,
              content: currentContent,
            } : null,
          }));
        } else {
          clearInterval(streamInterval);
          toast.success('Summary report generated successfully');
        }
      }, 20);
    };

    return (
      <div className="flex flex-col h-full">

        

        
        <CanvasFlow 
          tasks={metadata?.tasks || []}
          agents={metadata?.agents || []}
          responses={metadata?.responses || []}
          summary={metadata?.summary || null}
          onExecuteAgent={handleExecuteAgent}
          onSummarize={handleSummarize}
          onRequestAgentSelection={handleRequestAgentSelection}
        />
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
              text: 'Please add a new task to the decomposition.',
            },
          ],
        });
      },
    },
    {
      icon: <MessageIcon />,
      description: 'Request agent suggestions',
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Please suggest additional agents that could help with these tasks.',
            },
          ],
        });
      },
    },
  ],
}); 