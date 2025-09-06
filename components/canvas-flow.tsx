'use client';

import React, {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
  type NodeDragHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PlayIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  BarChart3Icon,
  UserPlusIcon,
  ChevronDown,
  ChevronUp,
  RocketIcon,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Layout configuration for node positioning
const LAYOUT = {
  SPACING: {
    VERTICAL: {
      TASKS: 200,
      AGENTS: 250,
      SUMMARY_OFFSET: 150,
    },
    HORIZONTAL: {
      TASK_TO_AGENT: 400,
      AGENT_TO_RESPONSE: 400,
    },
  },
  INITIAL: {
    TITLE: { x: 50, y: 50 },
    TASK: { x: 50, y: 200 },
    AGENT: { x: 450, y: 200 },
    RESPONSE: { x: 850, y: 200 },
  },
} as const;

// Visual styling configuration
const STYLES = {
  EDGES: {
    TASK_CHAIN: { stroke: '#3b82f6', strokeWidth: 3 },
    TASK_TO_SUMMARY: {
      stroke: '#8b5cf6',
      strokeWidth: 3,
      strokeDasharray: '5,5',
    },
    TASK_TO_AGENT: {
      stroke: '#10b981',
      strokeWidth: 3,
      strokeDasharray: '3,3',
    },
    AGENT_TO_RESPONSE: { stroke: '#f59e0b', strokeWidth: 3 },
    TITLE_TO_TASK: {
      stroke: '#8b5cf6',
      strokeWidth: 3,
      strokeDasharray: '5,5',
    },
  },
  HANDLES: {
    DEFAULT: { width: '12px', height: '12px' },
    COLORS: {
      PURPLE: '#8b5cf6',
      BLUE: '#3b82f6',
      ORANGE: '#f59e0b',
    },
  },
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
  pricingUsdt?: number; // Optional: price per call in USDT
  walletAddress?: string; // Optional: ETH wallet address
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
  onExecuteAllAgents: () => void;
  onSummarize: () => void;
  isGenerating?: boolean;
  allAgentsExecuted?: boolean;
  documentTitle?: string; // Title of the Canvas document
}

// Custom Task Decomposition Title Node Component with Vertical Handles
const TaskDecompositionTitleNode = ({
  data,
}: { data: { isGenerating?: boolean; documentTitle?: string } }) => {
  const displayTitle = data?.documentTitle || 'Task Decomposition';

  return (
    <Card className="w-80 bg-white shadow-lg border-2 border-purple-200 relative">
      {/* Output handle on the bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="task-decomposition-title-output"
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.PURPLE,
        }}
      />

      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-purple-800 flex-1 pr-2">
            {displayTitle}
          </CardTitle>
          {data?.isGenerating && (
            <Badge
              variant="secondary"
              className="bg-purple-100 text-purple-800 text-xs shrink-0"
            >
              <ClockIcon className="size-3 mr-1" />
              Generating
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xs text-gray-600">Workflow Steps</div>
      </CardContent>
    </Card>
  );
};

// Custom Individual Task Node Component with Vertical and Horizontal Handles
const TaskNode = ({ data }: { data: { task: Task } }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="w-80 bg-white shadow-lg border-2 border-blue-200 relative">
      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Top}
        id={`task-${data.task.id}-input-top`}
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.PURPLE,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={`task-${data.task.id}-input-left`}
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.PURPLE,
        }}
      />

      {/* Output handles */}
      <Handle
        type="source"
        position={Position.Bottom}
        id={`task-${data.task.id}-output-bottom`}
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.BLUE,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={`task-${data.task.id}-output-right`}
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.BLUE,
        }}
      />

      <CardHeader className="pb-3">
        <div className="space-y-2">
          {/* Title row with status and expand button */}
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-blue-800 flex-1">
              {data.task.title}
            </CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              {data.task.status === 'pending' && (
                <Badge
                  variant="secondary"
                  className="bg-yellow-100 text-yellow-800 text-xs"
                >
                  <ClockIcon className="size-3 mr-1" />
                  Pending
                </Badge>
              )}
              {data.task.status === 'recruiting' && (
                <Badge
                  variant="secondary"
                  className="bg-purple-100 text-purple-800 text-xs"
                >
                  <UserPlusIcon className="size-3 mr-1" />
                  Recruiting
                </Badge>
              )}
              {data.task.status === 'in-progress' && (
                <Badge
                  variant="secondary"
                  className="bg-blue-100 text-blue-800 text-xs"
                >
                  <PlayIcon className="size-3 mr-1" />
                  Active
                </Badge>
              )}
              {data.task.status === 'completed' && (
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-800 text-xs"
                >
                  <CheckIcon className="size-3 mr-1" />
                  Completed
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExpanded((prev) => !prev)}
                className="size-6 p-0"
                aria-label={
                  expanded ? 'Collapse task details' : 'Expand task details'
                }
              >
                {expanded ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Description row - full width */}
          <div className="text-xs text-gray-600 leading-relaxed">
            {data.task.description}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Execute Button - Always Visible */}
        <Button
          onClick={() => {
            console.log(`Execute task: ${data.task.id}`);
            // TODO: Add actual backend execution logic
          }}
          disabled={
            data.task.status === 'completed' ||
            data.task.status === 'in-progress'
          }
          className={`w-full ${
            data.task.status === 'completed'
              ? 'bg-green-100 text-green-800 cursor-not-allowed'
              : data.task.status === 'in-progress'
                ? 'bg-blue-100 text-blue-800 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
          size="sm"
        >
          {data.task.status === 'completed' && (
            <>
              <CheckIcon className="size-4 mr-2" />
              Completed
            </>
          )}
          {data.task.status === 'in-progress' && (
            <>
              <PlayIcon className="size-4 mr-2" />
              Running...
            </>
          )}
          {(data.task.status === 'pending' ||
            data.task.status === 'recruiting') && (
            <>
              <PlayIcon className="size-4 mr-2" />
              Execute Task
            </>
          )}
        </Button>

        {/* Expanded Details */}
        {expanded && (
          <div className="space-y-2">
            <div className="text-xs text-gray-500">
              <div className="font-medium mb-1">Task Details:</div>
              <div className="space-y-1">
                <div>
                  <span className="font-medium">ID:</span> {data.task.id}
                </div>
                <div>
                  <span className="font-medium">Status:</span>{' '}
                  {data.task.status}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Custom Agent Card Node Component with Handles
const AgentCardNode = ({ data }: { data: { agent: Agent } }) => {
  const [expanded, setExpanded] = useState(false);

  const generatePriceFromId = useCallback((seed: string): number => {
    // Simple deterministic pseudo-random based on string char codes
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const min = 0.25; // USDT
    const max = 2.5; // USDT
    const normalized = (hash % 1000) / 1000; // 0..1
    const price = min + normalized * (max - min);
    return Math.round(price * 100) / 100; // 2 decimals
  }, []);

  const generateWalletFromId = useCallback((seed: string): string => {
    // Generate deterministic hex string from seed
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
    }
    let hex = '';
    for (let i = 0; i < 40; i++) {
      // shift and mix
      hash = (hash ^ (hash << 5)) + (hash >>> 2);
      const nibble = (hash >>> (i % 28)) & 0xf;
      hex += nibble.toString(16);
    }
    return `0x${hex}`;
  }, []);

  const priceUsdt = useMemo(() => {
    return typeof data.agent.pricingUsdt === 'number'
      ? data.agent.pricingUsdt
      : generatePriceFromId(`${data.agent.id}:${data.agent.name}`);
  }, [
    data.agent.id,
    data.agent.name,
    data.agent.pricingUsdt,
    generatePriceFromId,
  ]);

  const walletAddress = useMemo(() => {
    return (
      data.agent.walletAddress ||
      generateWalletFromId(`${data.agent.id}:${data.agent.name}`)
    );
  }, [
    data.agent.id,
    data.agent.name,
    data.agent.walletAddress,
    generateWalletFromId,
  ]);

  return (
    <Card className="w-72 bg-white shadow-lg border-2 border-green-200 relative">
      {/* Handles for connections */}
      <Handle
        type="target"
        position={Position.Left}
        id={`agent-${data.agent.id}-input`}
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.BLUE,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={`agent-${data.agent.id}-output`}
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.ORANGE,
        }}
      />

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-green-800">
            {data.agent.name}
          </CardTitle>
          <span className="text-xs font-bold text-gray-700">
            ${priceUsdt.toFixed(2)} USDT/Call
          </span>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded((prev) => !prev)}
            className="size-6 p-0"
            aria-label={
              expanded ? 'Collapse agent details' : 'Expand agent details'
            }
          >
            {expanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-600">{data.agent.description}</p>

        {/* Tags - only when expanded */}
        {expanded && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {data.agent.capabilities.map((capability) => (
                <Badge key={capability} variant="outline" className="text-xs">
                  {capability}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Wallet - only when expanded */}
        {expanded && (
          <div className="text-xs text-gray-700">
            <div className="font-medium">ETH Wallet</div>
            <div className="font-mono break-all text-gray-800">
              {walletAddress}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Custom Response Node Component with Handles
const ResponseNode = ({
  data,
}: { data: { response: Response; agentName: string } }) => {
  return (
    <Card className="w-80 bg-white shadow-lg border-2 border-orange-200 relative">
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id={`response-${data.response.id}-input`}
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.ORANGE,
        }}
      />

      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-orange-800 flex items-center">
          <FileTextIcon className="size-5 mr-2" />
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
const SummaryNode = ({
  data,
}: { data: { summary: Summary | null; onSummarize: () => void } }) => {
  return (
    <Card className="w-96 bg-white shadow-lg border-2 border-purple-200 relative">
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="summary-input"
        style={{
          ...STYLES.HANDLES.DEFAULT,
          background: STYLES.HANDLES.COLORS.PURPLE,
        }}
      />

      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-purple-800 flex items-center">
          <BarChart3Icon className="size-5 mr-2" />
          Summary Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-gray-700 leading-relaxed">
          {data.summary?.content ||
            'No summary generated yet. Click the button below to generate summary based on all responses.'}
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
          <BarChart3Icon className="size-4 mr-2" />
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

export function CanvasFlow({
  tasks,
  agents,
  responses,
  summary,
  onExecuteAllAgents,
  onSummarize,
  isGenerating = false,
  allAgentsExecuted = false,
  documentTitle,
}: CanvasFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Transaction confirmation dialog state
  const [isTxDialogOpen, setIsTxDialogOpen] = useState(false);
  const [showAdvancedTxDetails, setShowAdvancedTxDetails] = useState(false);

  // Web3-like transaction display defaults (can be made configurable later)
  const networkName = 'Ethereum Mainnet';
  const tokenSymbol = 'USDT (ERC20)';
  const estimatedGasLimit = 65000; // simple transfer estimate
  const gasPriceGwei = 15; // example gas price
  const estimatedGasEth = useMemo(
    () => (estimatedGasLimit * gasPriceGwei) / 1e9,
    [estimatedGasLimit, gasPriceGwei],
  );
  const estimatedConfirmation = '~15s';
  const shortenAddress = (addr: string) =>
    addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

  // Calculate total cost for all agents
  const calculateTotalCost = useCallback(() => {
    return agents.reduce((total, agent) => {
      const price =
        typeof agent.pricingUsdt === 'number'
          ? agent.pricingUsdt
          : (() => {
              // Generate price from agent ID (same logic as in AgentCardNode)
              let hash = 0;
              const seed = `${agent.id}:${agent.name}`;
              for (let i = 0; i < seed.length; i++) {
                hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
              }
              const min = 0.25;
              const max = 2.5;
              const normalized = (hash % 1000) / 1000;
              return Math.round((min + normalized * (max - min)) * 100) / 100;
            })();
      return total + price;
    }, 0);
  }, [agents]);

  const openBatchTransactionDialog = useCallback(() => {
    setIsTxDialogOpen(true);
    setShowAdvancedTxDetails(false);
  }, []);

  const confirmAndExecuteAll = useCallback(() => {
    // Execute all agents at once
    onExecuteAllAgents();
    setIsTxDialogOpen(false);
  }, [onExecuteAllAgents]);

  // Store node positions to persist them during updates
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );

  // Handle node drag to save positions
  const onNodeDragStop: NodeDragHandler = useCallback((event, node) => {
    nodePositionsRef.current.set(node.id, node.position);
  }, []);

  // Update nodes and edges when tasks, agents, responses change
  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Add Task Decomposition title node
    newNodes.push({
      id: 'task-decomposition-title',
      type: 'taskDecompositionTitle',
      position:
        nodePositionsRef.current.get('task-decomposition-title') ||
        LAYOUT.INITIAL.TITLE,
      data: { isGenerating, documentTitle },
    });

    // Add individual Task nodes in a vertical chain with proper spacing for edge visibility
    tasks.forEach((task, index) => {
      const savedPosition = nodePositionsRef.current.get(`task-${task.id}`);
      const defaultPosition = {
        x: LAYOUT.INITIAL.TASK.x,
        y: LAYOUT.INITIAL.TASK.y + index * LAYOUT.SPACING.VERTICAL.TASKS,
      };

      newNodes.push({
        id: `task-${task.id}`,
        type: 'task',
        position: savedPosition || defaultPosition,
        data: { task },
      });
    });

    // Add Agent Card nodes positioned horizontally from tasks with proper spacing
    agents.forEach((agent, index) => {
      const savedPosition = nodePositionsRef.current.get(`agent-${agent.id}`);
      const defaultPosition = {
        x: LAYOUT.INITIAL.AGENT.x,
        y: LAYOUT.INITIAL.AGENT.y + index * LAYOUT.SPACING.VERTICAL.AGENTS,
      };

      newNodes.push({
        id: `agent-${agent.id}`,
        type: 'agentCard',
        position: savedPosition || defaultPosition,
        data: {
          agent,
        },
      });
    });

    // Add Response nodes positioned horizontally from agents with proper spacing
    responses.forEach((response, index) => {
      const agent = agents.find((a) => a.id === response.agentId);
      if (agent) {
        const savedPosition = nodePositionsRef.current.get(
          `response-${response.id}`,
        );
        const defaultPosition = {
          x: LAYOUT.INITIAL.RESPONSE.x,
          y: LAYOUT.INITIAL.RESPONSE.y + index * LAYOUT.SPACING.VERTICAL.AGENTS,
        };

        newNodes.push({
          id: `response-${response.id}`,
          type: 'response',
          position: savedPosition || defaultPosition,
          data: {
            response,
            agentName: agent.name,
          },
        });
      }
    });

    // Add Summary node only if there are responses to summarize
    if (responses.length > 0) {
      const savedPosition = nodePositionsRef.current.get('summary-node');
      const defaultPosition = {
        x: LAYOUT.INITIAL.TASK.x,
        y:
          LAYOUT.INITIAL.TASK.y +
          tasks.length * LAYOUT.SPACING.VERTICAL.TASKS +
          LAYOUT.SPACING.VERTICAL.SUMMARY_OFFSET,
      };

      newNodes.push({
        id: 'summary-node',
        type: 'summary',
        position: savedPosition || defaultPosition,
        data: { summary, onSummarize },
      });
    }

    // Create task chain: title -> task1 -> task2 -> task3 -> task4 (vertical)
    if (tasks.length > 0) {
      // Connect title to first task
      newEdges.push({
        id: 'tt-1',
        source: 'task-decomposition-title',
        target: `task-${tasks[0].id}`,
        type: 'default',
        style: STYLES.EDGES.TITLE_TO_TASK,
      });

      // Connect tasks in sequence (vertical)
      for (let i = 0; i < tasks.length - 1; i++) {
        newEdges.push({
          id: `tt-${i + 1}-${i + 2}`,
          source: `task-${tasks[i].id}`,
          target: `task-${tasks[i + 1].id}`,
          type: 'default',
          style: STYLES.EDGES.TASK_CHAIN,
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
          style: STYLES.EDGES.TASK_TO_SUMMARY,
        });
      }
    }

    // Create task-agent connections for associated agents
    const uniqueAgents = agents.filter(
      (agent, index, self) =>
        index === self.findIndex((a) => a.id === agent.id),
    );

    uniqueAgents.forEach((agent) => {
      if (agent.taskId) {
        const taskNodeExists = newNodes.some(
          (n) => n.id === `task-${agent.taskId}`,
        );
        const agentNodeExists = newNodes.some(
          (n) => n.id === `agent-${agent.id}`,
        );

        if (taskNodeExists && agentNodeExists) {
          const edgeId = `ta-${agent.taskId}-${agent.id}`;
          const edgeExists = newEdges.some((edge) => edge.id === edgeId);

          if (!edgeExists) {
            newEdges.push({
              id: edgeId,
              source: `task-${agent.taskId}`,
              target: `agent-${agent.id}`,
              sourceHandle: `task-${agent.taskId}-output-right`,
              targetHandle: `agent-${agent.id}-input`,
              type: 'default',
              style: STYLES.EDGES.TASK_TO_AGENT,
            });
          }
        }
      }
    });

    // Connect agents to their responses
    responses.forEach((response) => {
      const agentNodeExists = newNodes.some(
        (n) => n.id === `agent-${response.agentId}`,
      );
      const responseNodeExists = newNodes.some(
        (n) => n.id === `response-${response.id}`,
      );

      if (agentNodeExists && responseNodeExists) {
        const edgeId = `ar-${response.agentId}-${response.id}`;
        const edgeExists = newEdges.some((edge) => edge.id === edgeId);

        if (!edgeExists) {
          newEdges.push({
            id: edgeId,
            source: `agent-${response.agentId}`,
            target: `response-${response.id}`,
            sourceHandle: `agent-${response.agentId}-output`,
            targetHandle: `response-${response.id}-input`,
            type: 'default',
            style: STYLES.EDGES.AGENT_TO_RESPONSE,
          });
        }
      }
    });

    // Update both nodes and edges atomically to prevent flickering
    setNodes(newNodes);
    setEdges(newEdges);
  }, [
    tasks,
    agents,
    responses,
    summary,
    onSummarize,
    isGenerating,
    documentTitle,
  ]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [],
  );

  return (
    <div className="size-full relative">
      {/* Execute All Agents Button - Floating Action */}
      {agents.length > 0 && !allAgentsExecuted && (
        <div className="absolute top-4 right-4 z-10">
          <Button
            onClick={openBatchTransactionDialog}
            className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white shadow-lg"
            size="lg"
          >
            <RocketIcon className="size-5 mr-2" />
            Execute All Agents ({agents.length})
          </Button>
        </div>
      )}

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

      {/* Batch Transaction Confirmation Dialog */}
      <AlertDialog open={isTxDialogOpen} onOpenChange={setIsTxDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm Batch Transaction - Execute All Agents
            </AlertDialogTitle>
            <div className="space-y-4 text-sm text-muted-foreground">
              {/* Agents to Execute */}
              <div>
                <div className="font-medium text-base mb-2">
                  Agents to Execute ({agents.length})
                </div>
                <div className="bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                  {agents.map((agent, index) => {
                    const price =
                      typeof agent.pricingUsdt === 'number'
                        ? agent.pricingUsdt
                        : (() => {
                            let hash = 0;
                            const seed = `${agent.id}:${agent.name}`;
                            for (let i = 0; i < seed.length; i++) {
                              hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
                            }
                            const min = 0.25;
                            const max = 2.5;
                            const normalized = (hash % 1000) / 1000;
                            return (
                              Math.round(
                                (min + normalized * (max - min)) * 100,
                              ) / 100
                            );
                          })();
                    return (
                      <div
                        key={agent.id}
                        className="flex justify-between items-center"
                      >
                        <span className="font-medium">
                          {index + 1}. {agent.name}
                        </span>
                        <span className="text-gray-600">
                          ${price.toFixed(2)} USDT
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Transaction Summary */}
              <div className="border-t pt-3">
                <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                  <div className="text-muted-foreground">Network</div>
                  <div className="col-span-2">{networkName}</div>

                  <div className="text-muted-foreground">From</div>
                  <div className="col-span-2">Your wallet</div>

                  <div className="text-muted-foreground">Token</div>
                  <div className="col-span-2">{tokenSymbol}</div>

                  <div className="text-muted-foreground">Total Amount</div>
                  <div className="col-span-2 font-bold text-lg">
                    ${calculateTotalCost().toFixed(2)} USDT
                  </div>

                  <div className="text-muted-foreground">Network fee</div>
                  <div className="col-span-2">
                    ~{(estimatedGasEth * agents.length).toFixed(6)} ETH (
                    {agents.length} transactions)
                  </div>

                  <div className="text-muted-foreground">Est. time</div>
                  <div className="col-span-2">{estimatedConfirmation}</div>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                  onClick={() => setShowAdvancedTxDetails((v) => !v)}
                >
                  {showAdvancedTxDetails ? (
                    <ChevronUp className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                  {showAdvancedTxDetails
                    ? 'Hide advanced details'
                    : 'Show advanced details'}
                </button>
                {showAdvancedTxDetails && (
                  <div className="mt-2 rounded-md border p-3 space-y-1 text-xs">
                    <div>
                      <span className="font-medium">Batch Execution:</span>{' '}
                      {agents.length} agents
                    </div>
                    <div>
                      <span className="font-medium">Method:</span>{' '}
                      executeAllAgents()
                    </div>
                    <div>
                      <span className="font-medium">Total Tasks:</span>{' '}
                      {tasks.length}
                    </div>
                    <div className="text-muted-foreground">
                      All agents will be executed in parallel via the Python
                      orchestrator.
                    </div>
                    <div className="text-muted-foreground">
                      You will be asked to confirm this batch transaction in
                      your wallet.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsTxDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmAndExecuteAll}>
              Confirm and Execute All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
