import { A2aChatLanguageModel } from './a2a-chat-language-model';

export interface A2aSettings {
  contextId?: string; // For grouping related requests and maintaining context
  debug?: boolean;
  toolcallSupport?: boolean;
  taskMode?: boolean;
  toolHandling?: 'structured' | 'describe' | 'reject';
  timeout?: number; // Timeout in milliseconds
  maxRetries?: number; // Maximum retry attempts
  maxHistoryLength?: number; // Maximum conversation history to include (default: 5)
  pushNotificationConfig?: {
    url: string; // Webhook URL for async notifications
    token: string; // Authentication token for webhook (auto-generated if not provided)
  };
  chatId?: string; // Chat session ID for context mapping
  documentId?: string; // Canvas document ID to include in message context
}

export function a2a(
  agentUrl: string,
  settings?: A2aSettings,
): A2aChatLanguageModel {
  if (!agentUrl) {
    throw new Error('Agent URL is required');
  }
  return new A2aChatLanguageModel(agentUrl, {
    maxHistoryLength: 5,
    maxRetries: 3,
    ...settings,
  });
}

// Default export for convenience
export default a2a;
