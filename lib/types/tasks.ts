// Shared type definitions for task operations across the application
// These types align with the database schema and A2A specification

// A2A Task State enum as defined in A2A specification
export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

export interface AssignedAgent {
  id: string;
  name: string;
  capabilities: string[];
  pricingUsdt?: number;
  walletAddress?: string;
}

export interface TaskResultData {
  title: string;
  description: string;
  assignedAgent?: AssignedAgent;
  order?: number;
}

export interface TaskInput {
  id?: string;
  title: string;
  description: string;
  status?: TaskState; // Use proper TaskState type
  assignedAgent?: AssignedAgent;
}

export interface TaskStatusResponse {
  id: string;
  status: TaskState; // Use proper TaskState type
  title: string;
  description: string;
  assignedAgent?: AssignedAgent;
  statusMessage?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface CanvasCreateRequest {
  tasks: TaskInput[];
  chatId: string;
}

export interface CanvasCreateResponse {
  success: boolean;
  canvas: {
    id: string;
    title: string;
    taskIds: string[];
    tasks: TaskStatusResponse[];
    webhookToken: string;
    referenceId: string;
  };
  message: string;
}

// Alias for backward compatibility with database schema
export type TaskStatus = TaskState;
