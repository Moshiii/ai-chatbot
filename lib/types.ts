import { z } from 'zod';

import type { ArtifactKind } from '@/components/artifact';
import type { Suggestion } from './db/schema';

export type DataPart = { type: 'append-message'; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

// Task status enum for validation and type safety
export const taskStatusEnum = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
] as const;

export const taskStatusSchema = z.enum(taskStatusEnum);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

// Helper function to safely parse and transform task status
export const parseTaskStatus = (status: string): TaskStatus => {
  const result = taskStatusSchema.safeParse(status);
  return result.success ? result.data : 'unknown';
};

// Transform database status to UI status
export const transformTaskStatusToUI = (
  status: string,
): 'pending' | 'in-progress' | 'completed' | 'recruiting' => {
  const parsedStatus = parseTaskStatus(status);

  switch (parsedStatus) {
    case 'completed':
      return 'completed';
    case 'working':
      return 'in-progress';
    case 'input-required':
    case 'auth-required':
      return 'recruiting';
    case 'submitted':
    case 'unknown':
    default:
      return 'pending';
  }
};

// Use AI SDK v5 tool types - tools are defined as records with tool names
// Use any to be compatible with different tool implementations
export type ChatTools = Record<string, any>;

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  canvasReference: {
    artifactType: 'document';
    documentId: string;
  };
};

// Use UIMessage directly from AI SDK v5 - no custom wrapper needed
// The metadata and data types are handled through the parts structure

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
}

// Stack Auth Session type to replace NextAuth Session
export type AppSession = {
  user: {
    id: string;
    type: 'regular' | 'guest';
  };
};

// Stack Auth User type
export type AppUser = {
  id: string;
  email: string;
  name?: string;
  image?: string;
};
