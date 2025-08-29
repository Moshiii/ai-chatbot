import type {
  Message,
  MessageSendParams,
  SendMessageResponse,
  SendMessageSuccessResponse,
  Task,
  Part,
} from '@a2a-js/sdk';
import { A2AClient } from '@a2a-js/sdk/client';

import {
  type LanguageModelV2,
  type LanguageModelV2Prompt,
  type LanguageModelV2Content,
  type LanguageModelV2StreamPart,
  type LanguageModelV2FilePart,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import { generateId } from 'ai';
import { contextUtils } from '@/lib/context-management';

import type { A2aSettings } from './a2a-provider';

// Define proper types for A2A tool events
interface A2AToolEvent {
  type:
    | 'toolcall_initiated'
    | 'toolcall_progress'
    | 'toolcall_completed'
    | 'toolcall_failed';
  toolcall: {
    id: string;
    function: string;
    arguments?: any;
    result?: any;
    error?: string;
    status: string;
  };
  context_id?: string;
  timestamp?: string;
}

// Simplified constants
const DEFAULTS = {
  TIMEOUT: 10000,
  MAX_RETRIES: 2,
  MAX_HISTORY: 3,
  RETRY_DELAYS: [500, 1000, 2000],
} as const;

export class A2aChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2';
  readonly provider = 'a2a';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = { '*/*': [/.+/] };

  private readonly settings: A2aSettings;
  private client: A2AClient;

  constructor(agentUrl: string, settings: A2aSettings) {
    if (!agentUrl) throw new Error('Agent URL is required for A2A provider');

    this.modelId = agentUrl;
    this.settings = { ...DEFAULTS, ...settings };

    // Generate context ID if not provided
    if (!this.settings.contextId && this.settings.chatId) {
      this.settings.contextId = contextUtils.generateContextId(
        this.settings.chatId,
      );
    }

    // Auto-generate webhook token if URL provided but no token
    if (
      this.settings.pushNotificationConfig?.url &&
      !this.settings.pushNotificationConfig.token
    ) {
      this.settings.pushNotificationConfig.token =
        contextUtils.generateWebhookToken();
    }

    this.client = new A2AClient(agentUrl);
  }

  async doGenerate(options: Parameters<LanguageModelV2['doGenerate']>[0]) {
    console.log('[A2A] Starting doGenerate');
    const message = this.createA2AMessage(options.prompt);
    console.log('[A2A] Created message:', JSON.stringify(message, null, 2));

    const response = await this.sendMessage(message);
    console.log('[A2A] Received response:', JSON.stringify(response, null, 2));

    const content = this.extractContent(response);
    console.log('[A2A] Extracted content:', content);

    return {
      content,
      finishReason: 'stop' as const,
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
      request: { body: { message } },
      response: { body: response },
      warnings: [],
    };
  }

  async doStream(options: Parameters<LanguageModelV2['doStream']>[0]) {
    console.log('[A2A] Starting doStream');
    const message = this.createA2AMessage(options.prompt);
    console.log('[A2A] Stream message:', JSON.stringify(message, null, 2));

    try {
      console.log('[A2A] Sending stream request to agent');
      const response = await this.client.sendMessageStream({
        message,
        configuration: {
          blocking: false,
          acceptedOutputModes: ['text/plain', 'application/json'],
          pushNotificationConfig: this.settings.pushNotificationConfig
            ? {
                url: this.settings.pushNotificationConfig.url,
                token: this.settings.pushNotificationConfig.token,
              }
            : undefined,
        },
      });
      console.log('[A2A] Stream response received, creating stream');

      return this.createStreamFromA2A(response);
    } catch (error: any) {
      console.log(
        '[A2A] Stream failed, falling back to non-streaming:',
        error.message,
      );
      const result = await this.doGenerate(options);
      return this.createStreamFromResult(result);
    }
  }

  private createA2AMessage(prompt: LanguageModelV2Prompt): Message {
    const lastMessage = prompt[prompt.length - 1];
    const messageText = this.buildMessageText(prompt);
    const parts: Part[] = [{ kind: 'text', text: messageText }];

    // Add non-text parts if present
    if (typeof lastMessage.content !== 'string') {
      const nonTextParts = lastMessage.content
        .filter((part: any) => part.type !== 'text')
        .map((part: any) => this.convertPart(part));
      parts.push(...nonTextParts);
    }

    return {
      kind: 'message',
      messageId: generateId(),
      role: 'user',
      parts,
      contextId: this.settings.contextId,
      // Include canvas document ID in metadata for A2A agent
      ...(this.settings.documentId && {
        metadata: {
          canvasDocumentId: this.settings.documentId,
        },
      }),
    };
  }

  private buildMessageText(prompt: LanguageModelV2Prompt): string {
    const { history, current } = this.buildHistory(prompt);
    const header = history.length
      ? `Previous conversation:\n${history.join('\n')}\n\n`
      : '';
    return `${header}Current request:\n${current}`;
  }

  private buildHistory(prompt: LanguageModelV2Prompt): {
    history: string[];
    current: string;
  } {
    const last = prompt[prompt.length - 1];
    const current = this.extractText(last);
    const lines: string[] = [];
    const limit = this.settings.maxHistoryLength ?? DEFAULTS.MAX_HISTORY;

    // Process recent messages for context
    for (let i = prompt.length - 2; i >= 0 && lines.length < limit * 2; i--) {
      const m: any = prompt[i];
      if (m.role !== 'user' && m.role !== 'assistant') continue;

      const text = this.extractText(m);
      if (text) {
        lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`);
      }
    }

    return { history: lines.reverse(), current };
  }

  private extractText(message: any): string {
    if (typeof message.content === 'string') return message.content;

    return (
      message.content
        ?.filter((part: any) => part.type === 'text')
        ?.map((part: any) => part.text)
        ?.join(' ') || '[complex content]'
    );
  }

  private convertPart(part: LanguageModelV2FilePart): Part {
    if (part.type !== 'file') {
      throw new UnsupportedFunctionalityError({
        functionality: `Part type: ${part.type}`,
      });
    }

    if (part.data instanceof URL) {
      return {
        kind: 'file',
        file: {
          mimeType: part.mediaType,
          name: part.filename,
          uri: part.data.toString(),
        },
      };
    }

    const bytes =
      typeof part.data === 'string'
        ? Buffer.from(part.data, 'utf-8').toString('base64')
        : Buffer.from(part.data).toString('base64');

    return {
      kind: 'file',
      file: { mimeType: part.mediaType, name: part.filename, bytes },
    };
  }

  private async sendMessage(message: Message): Promise<Task | Message> {
    const params: MessageSendParams = {
      message,
      configuration: {
        blocking: false, // ✅ Critical: Must be false for ACK + webhook pattern
        acceptedOutputModes: ['text/plain', 'application/json'],
        pushNotificationConfig: this.settings.pushNotificationConfig
          ? {
              url: this.settings.pushNotificationConfig.url,
              token: this.settings.pushNotificationConfig.token,
            }
          : undefined,
      },
    };

    const maxRetries = this.settings.maxRetries || DEFAULTS.MAX_RETRIES;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response: SendMessageResponse =
          await this.client.sendMessage(params);

        if ('error' in response) {
          throw new Error(
            `A2A Error (${response.error.code || 'Unknown'}): ${response.error.message}`,
          );
        }

        return (response as SendMessageSuccessResponse).result;
      } catch (error: any) {
        lastError = error;

        // Don't retry client errors (4xx)
        if (error.code >= 400 && error.code < 500) throw error;

        if (attempt < maxRetries) {
          const delay = DEFAULTS.RETRY_DELAYS[attempt - 1] || 5000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Failed after ${maxRetries} attempts: ${this.formatError(lastError)}`,
    );
  }

  private extractContent(response: Task | Message): LanguageModelV2Content[] {
    const content: LanguageModelV2Content[] = [];

    const addParts = (parts: Part[]) => {
      parts.forEach((part) => {
        if (part.kind === 'text' && part.text) {
          content.push({ type: 'text', text: part.text });
        } else if (part.kind === 'file' && part.file) {
          content.push(this.convertFileToContent(part.file));
        } else if (part.kind === 'data' && part.data) {
          content.push({
            type: 'text',
            text: JSON.stringify(part.data, null, 2),
          });
        }
      });
    };

    if (response.kind === 'message') {
      addParts(response.parts);
    } else if (response.kind === 'task') {
      if (response.status.message) addParts(response.status.message.parts);
      if (response.artifacts)
        response.artifacts.forEach((artifact) => addParts(artifact.parts));
    }

    return content;
  }

  private convertFileToContent(file: any): LanguageModelV2Content {
    if ('bytes' in file) {
      return {
        type: 'file',
        mediaType: file.mimeType,
        data: Uint8Array.from(Buffer.from(file.bytes, 'base64')),
      };
    }
    return { type: 'file', mediaType: file.mimeType, data: file.uri };
  }

  private createStreamFromResult(result: any): {
    stream: ReadableStream<LanguageModelV2StreamPart>;
  } {
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'stream-start',
            warnings: result.warnings,
          });
          controller.enqueue({ type: 'response-metadata', id: generateId() });

          result.content.forEach((content: any) => {
            if (content.type === 'text') {
              const id = generateId();
              controller.enqueue({ type: 'text-start', id });
              controller.enqueue({
                type: 'text-delta',
                id,
                delta: content.text,
              });
              controller.enqueue({ type: 'text-end', id });
            } else if (content.type === 'file') {
              controller.enqueue({
                type: 'file',
                data: content.data,
                mediaType: content.mediaType,
              });
            }
          });

          controller.enqueue({
            type: 'finish',
            finishReason: result.finishReason,
            usage: result.usage,
          });
          controller.close();
        },
      }),
    };
  }

  private createStreamFromA2A(response: AsyncIterable<any>): {
    stream: ReadableStream<LanguageModelV2StreamPart>;
  } {
    const processor = new StreamProcessor();

    return {
      stream: new ReadableStream({
        async start(controller) {
          console.log('[A2A] Stream started, sending initial events');
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'response-metadata', id: generateId() });

          let chunkCount = 0;
          try {
            console.log('[A2A] Starting to iterate over response chunks');
            for await (const chunk of response) {
              chunkCount++;
              console.log(`[A2A] Received chunk ${chunkCount}:`, chunk);
              processor.processChunk(chunk, controller);
            }
            console.log(`[A2A] Finished processing ${chunkCount} chunks`);
          } catch (error: any) {
            console.error('[A2A] Stream error:', error);
            controller.error(new Error(`Stream error: ${error.message}`));
            return;
          }

          console.log('[A2A] Stream completed, sending finish event');
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
          });
          controller.close();
        },
      }),
    };
  }

  private formatError(error: any): string {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return `A2A agent is not available at ${this.modelId}. Please ensure the agent is running.`;
    }
    if (error.code === 'ETIMEDOUT') {
      return `A2A agent at ${this.modelId} is not responding. Request timed out.`;
    }
    return error.message || 'Unknown error';
  }
}

// Simplified StreamProcessor class
class StreamProcessor {
  private processedEvents = new Map<string, Set<string>>();
  private controllerClosed = false;

  processChunk(
    chunk: any,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
  ): void {
    if (this.controllerClosed) {
      console.log('[A2A] Controller already closed, skipping chunk');
      return;
    }
    // Handle different chunk types
    switch (chunk.kind) {
      case 'message':
        this.processMessageParts(chunk.parts, controller);
        break;

      case 'task':
        if (chunk.status?.message)
          this.processMessageParts(chunk.status.message.parts, controller);
        if (chunk.artifacts)
          chunk.artifacts.forEach((artifact: any) =>
            this.processMessageParts(artifact.parts, controller),
          );
        break;

      case 'artifact-update':
        if (chunk.artifact?.parts) {
          this.processArtifactParts(chunk.artifact.parts, controller);
        }
        break;

      case 'status-update':
      case 'task-status-update':
        if (chunk.status?.message)
          this.processMessageParts(chunk.status.message.parts, controller);
        if (this.isTaskComplete(chunk)) {
          this.controllerClosed = true;
          controller.enqueue({
            type: 'finish',
            finishReason: chunk.status?.state === 'failed' ? 'error' : 'stop',
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
          });
          controller.close();
        }
        break;
    }
  }

  private processArtifactParts(
    parts: Part[],
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
  ): void {
    for (const part of parts) {
      if (
        part.kind === 'data' &&
        'data' in part &&
        part.data &&
        typeof part.data === 'object' &&
        'type' in part.data &&
        typeof part.data.type === 'string' &&
        part.data.type.startsWith('toolcall_')
      ) {
        this.handleToolcallData(
          part.data as unknown as A2AToolEvent,
          controller,
        );
      }

      // Handle task status updates
      if ('data' in part && part.data && typeof part.data === 'object') {
        const data = part.data as Record<string, unknown>;
        const isStatusUpdate = ['task-status-update', 'status-update'].includes(
          (data.kind as string) || (data.type as string),
        );
        if (
          isStatusUpdate &&
          data.status &&
          typeof data.status === 'object' &&
          'message' in data.status &&
          data.status.message &&
          typeof data.status.message === 'object' &&
          'parts' in data.status.message
        ) {
          this.processMessageParts(
            (data.status.message as any).parts,
            controller,
          );
        }
      }
    }
  }

  private processMessageParts(
    parts: Part[],
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
  ): void {
    parts.forEach((part) => {
      try {
        if (part.kind === 'text' && part.text) {
          const id = generateId();
          controller.enqueue({ type: 'text-start', id });
          controller.enqueue({ type: 'text-delta', id, delta: part.text });
          controller.enqueue({ type: 'text-end', id });
        } else if (part.kind === 'file' && part.file) {
          controller.enqueue({
            type: 'file',
            data: 'bytes' in part.file ? part.file.bytes : part.file.uri,
            mediaType: part.file.mimeType as string,
          });
        }
      } catch (error: any) {
        console.log('[A2A] Controller closed, skipping part:', error.message);
      }
    });
  }

  private handleToolcallData(
    data: A2AToolEvent,
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
  ): boolean {
    try {
      const { toolcall, type } = data;
      const toolId = toolcall?.id;

      if (!toolId || !type) return false;

      // Dedupe events
      const seen = this.processedEvents.get(toolId) || new Set<string>();
      if (seen.has(type)) return false;
      seen.add(type);
      this.processedEvents.set(toolId, seen);

      if (type === 'toolcall_initiated' && toolcall.id && toolcall.function) {
        controller.enqueue({
          type: 'tool-call',
          toolCallId: toolcall.id,
          toolName: toolcall.function,
          input: JSON.stringify(toolcall.arguments || {}),
        });
        return true;
      }

      if (type === 'toolcall_failed') {
        controller.enqueue({
          type: 'error',
          error: new Error(
            `Tool ${toolcall.function} failed: ${toolcall.error}`,
          ),
        });
        return true;
      }

      return type === 'toolcall_completed'; // AI SDK handles completed events
    } catch (error: any) {
      console.error('Error processing toolcall data:', error);
      return false;
    }
  }

  private isTaskComplete(chunk: any): boolean {
    return (
      chunk.final === true ||
      chunk.status?.state === 'completed' ||
      chunk.status?.state === 'failed'
    );
  }
}
