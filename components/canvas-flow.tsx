'use client';

import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  EdgeTypes,
  NodeTypes,
  Handle,
  Position,
  NodeDragHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlayIcon, CheckIcon, ClockIcon, FileTextIcon, BarChart3Icon, UserPlusIcon } from 'lucide-react';

// Constants for node positioning and spacing
const LAYOUT_CONSTANTS = {
  VERTICAL_SPACING: {
    TASKS: 200,
    AGENTS_RESPONSES: 250,
    SUMMARY: 150,
  },
  HORIZONTAL_SPACING: {
    TASKS_TO_AGENTS: 400,
    AGENTS_TO_RESPONSES: 400,
  },
  INITIAL_POSITIONS: {
    TITLE: { x: 50, y: 50 },
    FIRST_TASK: { x: 50, y: 200 },
    FIRST_AGENT: { x: 450, y: 200 },
    FIRST_RESPONSE: { x: 850, y: 200 },
  },
} as const;

// Constants for edge styling
const EDGE_STYLES = {
  TASK_CHAIN: { stroke: '#3b82f6', strokeWidth: 3 },
  TASK_TO_SUMMARY: { stroke: '#8b5cf6', strokeWidth: 3, strokeDasharray: '5,5' },
  TASK_TO_AGENT: { stroke: '#10b981', strokeWidth: 3, strokeDasharray: '3,3' },
  AGENT_TO_RESPONSE: { stroke: '#f59e0b', strokeWidth: 3 },
  TITLE_TO_TASK: { stroke: '#8b5cf6', strokeWidth: 3, strokeDasharray: '5,5' },
} as const;

// Constants for handle styling
const HANDLE_STYLES = {
  TITLE_OUTPUT: { background: '#8b5cf6', width: '12px', height: '12px' },
  TASK_INPUT: { background: '#8b5cf6', width: '12px', height: '12px' },
  TASK_OUTPUT: { background: '#3b82f6', width: '12px', height: '12px' },
  AGENT_INPUT: { background: '#3b82f6', width: '12px', height: '12px' },
  AGENT_OUTPUT: { background: '#f59e0b', width: '12px', height: '12px' },
  RESPONSE_INPUT: { background: '#f59e0b', width: '12px', height: '12px' },
  SUMMARY_INPUT: { background: '#8b5cf6', width: '12px', height: '12px' },
} as const;

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'recruiting';
}

interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  taskId?: string; // Associate agent with specific task
}

interface Response {
  id: string;
  agentId: string;
  content: string;
  timestamp: Date;
}

interface Summary {
  id: string;
  content: string;
  timestamp: Date;
}

interface CanvasFlowProps {
  tasks: Task[];
  agents: Agent[];
  responses: Response[];
  summary: Summary | null;
  onExecuteAgent: (agentId: string) => void;
  onSummarize: () => void;
  onRequestAgentSelection?: (taskDescription: string, taskId?: string) => Promise<void>;
  isGenerating?: boolean;
}

// Custom Task Decomposition Title Node Component with Vertical Handles
const TaskDecompositionTitleNode = ({ data }: { data: { isGenerating?: boolean } }) => {
  return (
    <Card className="w-48 bg-white shadow-lg border-2 border-purple-200 relative">
      {/* Output handle on the bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="task-decomposition-title-output"
        style={HANDLE_STYLES.TITLE_OUTPUT}
      />
      
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-purple-800">
            Task Decomposition
          </CardTitle>
          {data?.isGenerating && (
            <Badge variant="secondary" className="bg-purple-100 text-purple-800 text-xs">
              <ClockIcon className="w-3 h-3 mr-1" />
              Generating
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xs text-gray-600">
          Workflow Steps
        </div>
      </CardContent>
    </Card>
  );
};

// Custom Individual Task Node Component with Vertical and Horizontal Handles
const TaskNode = ({ data }: { data: { task: Task; onRequestAgentSelection?: (taskDescription: string, taskId?: string) => Promise<void> } }) => {
  return (
    <Card className="w-64 bg-white shadow-lg border-2 border-blue-200 relative">
      {/* Input handle on the top */}
      <Handle
        type="target"
        position={Position.Top}
        id={`task-${data.task.id}-input-top`}
        style={HANDLE_STYLES.TASK_INPUT}
      />
      
      {/* Input handle on the left side */}
      <Handle
        type="target"
        position={Position.Left}
        id={`task-${data.task.id}-input-left`}
        style={HANDLE_STYLES.TASK_INPUT}
      />
      
      {/* Output handle on the bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        id={`task-${data.task.id}-output-bottom`}
        style={HANDLE_STYLES.TASK_OUTPUT}
      />
      
      {/* Output handle on the right side */}
      <Handle
        type="source"
        position={Position.Right}
        id={`task-${data.task.id}-output-right`}
        style={HANDLE_STYLES.TASK_OUTPUT}
      />
      
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-blue-800">
            {data.task.title}
          </CardTitle>
          <div className="flex items-center gap-2">
            {data.task.status === 'pending' && (
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">
                <ClockIcon className="w-3 h-3 mr-1" />
                Pending
              </Badge>
            )}
            {data.task.status === 'recruiting' && (
              <Badge variant="secondary" className="bg-purple-100 text-purple-800 text-xs">
                <UserPlusIcon className="w-3 h-3 mr-1" />
                Recruiting
              </Badge>
            )}
            {data.task.status === 'in-progress' && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-xs">
                <PlayIcon className="w-3 h-3 mr-1" />
                Active
              </Badge>
            )}
            {data.task.status === 'completed' && (
              <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">
                <CheckIcon className="w-3 h-3 mr-1" />
                Completed
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xs text-gray-600 mb-2">{data.task.description}</div>
        
        {/* Agent Selection Button */}
        {data.onRequestAgentSelection && (
          <Button 
            onClick={() => data.onRequestAgentSelection?.(data.task.description, data.task.id)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs"
            size="sm"
          >
            <UserPlusIcon className="w-3 h-3 mr-1" />
            Request Agent
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

// Custom Agent Card Node Component with Handles
const AgentCardNode = ({ data }: { data: { agent: Agent; onExecute: () => void; isExecuted: boolean } }) => {
  return (
    <Card className="w-72 bg-white shadow-lg border-2 border-green-200 relative">
      {/* Input handle on the left side */}
      <Handle
        type="target"
        position={Position.Left}
        id={`agent-${data.agent.id}-input`}
        style={HANDLE_STYLES.AGENT_INPUT}
      />
      
      {/* Output handle on the right side */}
      <Handle
        type="source"
        position={Position.Right}
        id={`agent-${data.agent.id}-output`}
        style={HANDLE_STYLES.AGENT_OUTPUT}
      />
      
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-green-800">
          {data.agent.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-600">{data.agent.description}</p>
        
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-700 uppercase tracking-wide">
            Capabilities
          </div>
          <div className="flex flex-wrap gap-1">
            {data.agent.capabilities.map((capability, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {capability}
              </Badge>
            ))}
          </div>
        </div>

        <Button 
          onClick={data.onExecute}
          disabled={data.isExecuted}
          className={`w-full ${
            data.isExecuted 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-green-600 hover:bg-green-700'
          } text-white`}
          size="sm"
        >
          {data.isExecuted ? (
            <>
              <CheckIcon className="w-4 h-4 mr-2" />
              Executed
            </>
          ) : (
            <>
              <PlayIcon className="w-4 h-4 mr-2" />
              Execute
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

// Custom Response Node Component with Handles
const ResponseNode = ({ data }: { data: { response: Response; agentName: string } }) => {
  return (
    <Card className="w-80 bg-white shadow-lg border-2 border-orange-200 relative">
      {/* Input handle on the left side */}
      <Handle
        type="target"
        position={Position.Left}
        id={`response-${data.response.id}-input`}
        style={HANDLE_STYLES.RESPONSE_INPUT}
      />
      
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-orange-800 flex items-center">
          <FileTextIcon className="w-5 h-5 mr-2" />
          {data.agentName} Response
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-gray-700 leading-relaxed">
          {data.response.content || 'Processing...'}
        </div>
        <div className="text-xs text-gray-500 mt-2">
          {data.response.timestamp.toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  );
};

// Custom Summary Node Component with Handles and Button
const SummaryNode = ({ data }: { data: { summary: Summary | null; onSummarize: () => void } }) => {
  return (
    <Card className="w-96 bg-white shadow-lg border-2 border-purple-200 relative">
      {/* Input handle on the top */}
      <Handle
        type="target"
        position={Position.Top}
        id="summary-input"
        style={HANDLE_STYLES.SUMMARY_INPUT}
      />
      
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-purple-800 flex items-center">
          <BarChart3Icon className="w-5 h-5 mr-2" />
          Summary Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-gray-700 leading-relaxed">
          {data.summary?.content || 'No summary generated yet. Click the button below to generate summary based on all responses.'}
        </div>
        {data.summary && (
          <div className="text-xs text-gray-500">
            {data.summary.timestamp.toLocaleTimeString()}
          </div>
        )}
        
        {/* Summarize Button */}
        <Button 
          onClick={data.onSummarize}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          size="sm"
        >
          <BarChart3Icon className="w-4 h-4 mr-2" />
          Generate Summary
        </Button>
      </CardContent>
    </Card>
  );
};

// Define custom node types
const nodeTypes: NodeTypes = {
  taskDecompositionTitle: TaskDecompositionTitleNode,
  task: TaskNode,
  agentCard: AgentCardNode,
  response: ResponseNode,
  summary: SummaryNode,
};

export function CanvasFlow({ tasks, agents, responses, summary, onExecuteAgent, onSummarize, onRequestAgentSelection, isGenerating = false }: CanvasFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  // Store node positions to persist them during updates
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Handle node drag to save positions
  const onNodeDragStop: NodeDragHandler = useCallback((event, node) => {
    nodePositionsRef.current.set(node.id, node.position);
  }, []);

  // Update nodes and edges when tasks, agents, responses, and summary change during streaming
  useEffect(() => {
    const newNodes: Node[] = [];
    
    // Clear existing edges to prevent conflicts
    console.log('Current edges before clearing:', edges.map(edge => edge.id));
    
    // Add Task Decomposition title node
    newNodes.push({
      id: 'task-decomposition-title',
      type: 'taskDecompositionTitle',
      position: nodePositionsRef.current.get('task-decomposition-title') || LAYOUT_CONSTANTS.INITIAL_POSITIONS.TITLE,
      data: { isGenerating },
    });

    // Add individual Task nodes in a vertical chain with proper spacing for edge visibility
    tasks.forEach((task, index) => {
      const savedPosition = nodePositionsRef.current.get(`task-${task.id}`);
      // Increase vertical spacing to ensure edges are visible
      const defaultPosition = { 
        x: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_TASK.x, 
        y: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_TASK.y + index * LAYOUT_CONSTANTS.VERTICAL_SPACING.TASKS 
      };
      
      newNodes.push({
        id: `task-${task.id}`,
        type: 'task',
        position: savedPosition || defaultPosition,
        data: { task, onRequestAgentSelection },
      });
    });

    // Add Agent Card nodes positioned horizontally from tasks with proper spacing
    agents.forEach((agent, index) => {
      const isExecuted = responses.some(r => r.agentId === agent.id);
      const savedPosition = nodePositionsRef.current.get(`agent-${agent.id}`);
      // Position agents horizontally from tasks with vertical spacing
      const defaultPosition = { 
        x: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_AGENT.x, 
        y: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_AGENT.y + index * LAYOUT_CONSTANTS.VERTICAL_SPACING.AGENTS_RESPONSES 
      };
      
      newNodes.push({
        id: `agent-${agent.id}`,
        type: 'agentCard',
        position: savedPosition || defaultPosition,
        data: { 
          agent,
          onExecute: () => onExecuteAgent(agent.id),
          isExecuted
        },
      });
    });

    // Add Response nodes positioned horizontally from agents with proper spacing
    responses.forEach((response, index) => {
      const agent = agents.find(a => a.id === response.agentId);
      if (agent) {
        const savedPosition = nodePositionsRef.current.get(`response-${response.id}`);
        // Position responses horizontally from agents with vertical spacing
        const defaultPosition = { 
          x: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_RESPONSE.x, 
          y: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_RESPONSE.y + index * LAYOUT_CONSTANTS.VERTICAL_SPACING.AGENTS_RESPONSES 
        };
        
        newNodes.push({
          id: `response-${response.id}`,
          type: 'response',
          position: savedPosition || defaultPosition,
          data: { 
            response,
            agentName: agent.name
          },
        });
      }
    });

    // Add Summary node only if there are responses to summarize
    if (responses.length > 0) {
      const savedPosition = nodePositionsRef.current.get('summary-node');
      // Position summary below the last task with spacing for better proximity
      const defaultPosition = { 
        x: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_TASK.x, 
        y: LAYOUT_CONSTANTS.INITIAL_POSITIONS.FIRST_TASK.y + tasks.length * LAYOUT_CONSTANTS.VERTICAL_SPACING.TASKS + LAYOUT_CONSTANTS.VERTICAL_SPACING.SUMMARY 
      };
      
      newNodes.push({
        id: 'summary-node',
        type: 'summary',
        position: savedPosition || defaultPosition,
        data: { summary, onSummarize },
      });
    }

    setNodes(newNodes);

    // Create edges connecting tasks to agents
    const newEdges: Edge[] = [];
    
    // Create task chain: title -> task1 -> task2 -> task3 -> task4 (vertical)
    if (tasks.length > 0) {
      // Connect title to first task
      newEdges.push({
        id: 'tt-1',
        source: 'task-decomposition-title',
        target: `task-${tasks[0].id}`,
        type: 'default',
        style: EDGE_STYLES.TITLE_TO_TASK
      });

      // Connect tasks in sequence (vertical)
      for (let i = 0; i < tasks.length - 1; i++) {
        newEdges.push({
          id: `tt-${i + 1}-${i + 2}`,
          source: `task-${tasks[i].id}`,
          target: `task-${tasks[i + 1].id}`,
          type: 'default',
          style: EDGE_STYLES.TASK_CHAIN
        });
      }

      // Connect the last task to the summary node only if responses exist
      if (responses.length > 0) {
        const lastTaskId = tasks[tasks.length - 1].id;
        newEdges.push({
          id: `ts-${lastTaskId}`,
          source: `task-${lastTaskId}`,
          target: 'summary-node',
          type: 'default',
          style: EDGE_STYLES.TASK_TO_SUMMARY
        });
        console.log('Created last task to summary edge:', `ts-${lastTaskId}`);
      }
    }
    
    // Create task-agent connections for associated agents
    // Filter out duplicate agents by ID to prevent edge conflicts
    const uniqueAgents = agents.filter((agent, index, self) => 
      index === self.findIndex(a => a.id === agent.id)
    );
    
    uniqueAgents.forEach((agent) => {
      if (agent.taskId) {
        const taskNodeExists = newNodes.some(n => n.id === `task-${agent.taskId}`);
        const agentNodeExists = newNodes.some(n => n.id === `agent-${agent.id}`);
        
        if (taskNodeExists && agentNodeExists) {
          const edgeId = `ta-${agent.taskId}-${agent.id}`;
          // Check if this edge already exists to prevent duplicates
          const edgeExists = newEdges.some(edge => edge.id === edgeId);
          
          if (!edgeExists) {
            newEdges.push({
              id: edgeId,
              source: `task-${agent.taskId}`,
              target: `agent-${agent.id}`,
              sourceHandle: `task-${agent.taskId}-output-right`,
              targetHandle: `agent-${agent.id}-input`,
              type: 'default',
              style: EDGE_STYLES.TASK_TO_AGENT
            });
            console.log('Created task-agent edge:', edgeId, 'for agent:', agent.id, 'task:', agent.taskId);
          } else {
            console.log('Skipping duplicate task-agent edge:', edgeId);
          }
        }
      }
    });

    // Connect agents to their responses horizontally
    responses.forEach((response) => {
      const agentNodeExists = newNodes.some(n => n.id === `agent-${response.agentId}`);
      const responseNodeExists = newNodes.some(n => n.id === `response-${response.id}`);
      
      if (agentNodeExists && responseNodeExists) {
        const edgeId = `ar-${response.agentId}-${response.id}`;
        // Check if this edge already exists to prevent duplicates
        const edgeExists = newEdges.some(edge => edge.id === edgeId);
        
        if (!edgeExists) {
          newEdges.push({
            id: edgeId,
            source: `agent-${response.agentId}`,
            target: `response-${response.id}`,
            sourceHandle: `agent-${response.agentId}-output`,
            targetHandle: `response-${response.id}-input`,
            type: 'default',
            style: EDGE_STYLES.AGENT_TO_RESPONSE
          });
          console.log('Created horizontal agent-response edge:', edgeId);
        }
      } else {
        console.log('Skipping response edge - nodes not ready:', { agentNodeExists, responseNodeExists, responseId: response.id });
      }
    });

    // Note: We no longer auto-connect responses to summary
    // The summary will be connected to the last task automatically

    console.log('Total edges created:', newEdges.length);
    console.log('All edge IDs:', newEdges.map(edge => edge.id));
    setEdges(newEdges);
  }, [tasks, agents, responses, summary, onExecuteAgent, onSummarize, setNodes, setEdges, isGenerating]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        className="bg-gray-50"
      >
        <Controls />
        <Background color="#aaa" gap={16} />
      </ReactFlow>
    </div>
  );
} 