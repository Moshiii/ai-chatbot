import { z } from 'zod';
import type { getWeather } from './ai/tools/get-weather';
import type { planTasks } from './ai/tools/plan-tasks';
import type { createDocument } from './ai/tools/create-document';
import type { createTask } from './ai/tools/create-task';
import type { updateTask } from './ai/tools/update-task';
import type { updateDocument } from './ai/tools/update-document';
import type { requestSuggestions } from './ai/tools/request-suggestions';
import type { InferUITool, UIMessage } from 'ai';

import type { ArtifactKind } from '@/components/artifact';
import type { Suggestion } from './db/schema';

export type DataPart = { type: 'append-message'; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type planTasksTool = InferUITool<ReturnType<typeof planTasks>>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type createTaskTool = InferUITool<ReturnType<typeof createTask>>;
type updateTaskTool = InferUITool<ReturnType<typeof updateTask>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;

export type ChatTools = {
  getWeather: weatherTool;
  planTasks: planTasksTool;
  createDocument: createDocumentTool;
  createTask: createTaskTool;
  updateTask: updateTaskTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
};

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
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
}
