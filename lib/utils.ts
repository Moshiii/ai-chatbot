import type { UIMessage } from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document } from '@/lib/db/schema';
import { ChatSDKError, type ErrorCode } from './errors';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    let errorData: { code: ErrorCode | 'unknown'; cause: string };
    try {
      errorData = await response.json();
    } catch {
      errorData = { code: 'unknown', cause: 'Network error' };
    }
    const { code, cause } = errorData;
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      let errorData: { code: ErrorCode | 'unknown'; cause: string };
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          code: 'unknown',
          cause: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
      const { code, cause } = errorData;
      throw new ChatSDKError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    // Check if it's a network error
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ChatSDKError('bad_request:api', 'Failed to connect to server');
    }

    // Check if user is offline (client-side only)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function getLocalStorage<T = unknown>(
  key: string,
  defaultValue: T = [] as T,
): T {
  if (typeof window === 'undefined') {
    return defaultValue;
  }

  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.warn(`Failed to parse localStorage item "${key}":`, error);
    return defaultValue;
  }
}

export function generateUUID(): string {
  // Use crypto.randomUUID() if available (modern browsers/Node.js 18.4+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback to the original implementation for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Modern response message types using UIMessage
type ResponseMessage = UIMessage;

export function getMostRecentUserMessage(messages: Array<UIMessage>) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number,
) {
  if (!documents) return new Date();
  if (index > documents.length) return new Date();

  return documents[index].createdAt;
}

export function getTrailingMessageId({
  messages,
}: {
  messages: Array<ResponseMessage>;
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) return null;

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

export function convertToUIMessages(messages: DBMessage[]): UIMessage[] {
  const uiMessages: UIMessage[] = messages.map((message) => {
    // Convert database parts to AI SDK v5 UIMessage parts
    const parts = Array.isArray(message.parts)
      ? message.parts.map((part: any) => {
          // Handle text parts
          if (part.type === 'text') {
            return { type: 'text' as const, text: part.text || '' };
          }
          // Handle file parts
          if (part.type === 'file') {
            return {
              type: 'file' as const,
              data: part.data || part.uri,
              mediaType:
                part.mediaType || part.mimeType || 'application/octet-stream',
            };
          }
          // Handle data parts (for tool calls, etc.)
          if (part.type === 'data') {
            return {
              type: 'data' as const,
              data: part.data,
            };
          }
          // Return other part types as-is (they might be tool calls)
          return part;
        })
      : [{ type: 'text' as const, text: '' }];

    return {
      id: message.id,
      role: message.role as 'user' | 'assistant' | 'system',
      parts,
    };
  });

  // Note: AI SDK v5's validateUIMessages expects a different signature
  // For now, we'll rely on TypeScript type checking and runtime validation
  // TODO: Implement proper message validation when needed

  return uiMessages;
}

export function getTextFromMessage(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is { type: 'text'; text: string } => part.type === 'text',
    )
    .map((part) => part.text)
    .join('');
}
