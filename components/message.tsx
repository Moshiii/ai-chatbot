'use client';
import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState } from 'react';
import type { Vote } from '@/lib/db/schema';
import { DocumentToolCall, DocumentToolResult } from './document';
import { PencilEditIcon, SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { MessageEditor } from './message-editor';
import { DocumentPreview } from './document-preview';
import { MessageReasoning } from './message-reasoning';
import { TaskCollector } from './task-collector';

import { useDataStream } from './data-stream-provider';

// Type narrowing is handled by TypeScript's control flow analysis
// The AI SDK provides proper discriminated unions for tool calls

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
}: {
  chatId: string;
  message: any; // Use any to avoid complex type constraints
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: any;
  regenerate: any;
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const attachmentsFromMessage = message.parts.filter(
    (part: any) => part.type === 'file',
  );

  useDataStream();

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': mode === 'edit',
              'group-data-[role=user]/message:w-fit': mode !== 'edit',
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div
            className={cn('flex flex-col gap-4 w-full', {
              'min-h-96': message.role === 'assistant' && requiresScrollPadding,
            })}
          >
            {attachmentsFromMessage.length > 0 && (
              <div
                data-testid={`message-attachments`}
                className="flex flex-row justify-end gap-2"
              >
                {attachmentsFromMessage.map((attachment: any) => (
                  <PreviewAttachment
                    key={attachment.url}
                    attachment={{
                      name: attachment.filename ?? 'file',
                      contentType: attachment.mediaType,
                      url: attachment.url,
                    }}
                  />
                ))}
              </div>
            )}

            {message.parts?.map((part: any, index: number) => {
              const { type } = part;
              const key = `message-${message.id}-part-${index}`;

              if (type === 'reasoning' && part.text?.trim().length > 0) {
                return (
                  <MessageReasoning
                    key={key}
                    isLoading={isLoading}
                    reasoning={part.text}
                  />
                );
              }

              if (type === 'text') {
                if (mode === 'view') {
                  return (
                    <div key={key} className="flex flex-row gap-2 items-start">
                      {message.role === 'user' && !isReadonly && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              data-testid="message-edit-button"
                              variant="ghost"
                              className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                              onClick={() => {
                                setMode('edit');
                              }}
                            >
                              <PencilEditIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit message</TooltipContent>
                        </Tooltip>
                      )}

                      <div
                        data-testid="message-content"
                        className={cn('flex flex-col gap-4', {
                          'bg-primary text-primary-foreground px-3 py-2 rounded-xl':
                            message.role === 'user',
                        })}
                      >
                        <Markdown>{sanitizeText(part.text)}</Markdown>
                      </div>
                    </div>
                  );
                }

                if (mode === 'edit') {
                  return (
                    <div key={key} className="flex flex-row gap-2 items-start">
                      <div className="size-8" />

                      <MessageEditor
                        key={message.id}
                        message={message}
                        setMode={setMode}
                        setMessages={setMessages}
                        regenerate={regenerate}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-getWeather') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  return (
                    <div
                      key={`weather-input-${toolCallId}`}
                      className="skeleton"
                    >
                      <Weather />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;
                  return (
                    <div key={`weather-output-${toolCallId}`}>
                      <Weather weatherAtLocation={output} />
                    </div>
                  );
                }
              }

              if (type === 'tool-createDocument') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  const { input } = part;
                  return (
                    <div key={`create-doc-input-${toolCallId}`}>
                      <DocumentPreview isReadonly={isReadonly} args={input} />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  if ('error' in output) {
                    return (
                      <div
                        key={`create-doc-error-${toolCallId}`}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error: {String(output.error)}
                      </div>
                    );
                  }

                  return (
                    <div key={`create-doc-output-${toolCallId}`}>
                      <DocumentPreview
                        isReadonly={isReadonly}
                        result={output}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-updateDocument') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  const { input } = part;

                  return (
                    <div key={`update-doc-input-${toolCallId}`}>
                      <DocumentToolCall
                        type="update"
                        args={input}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  if ('error' in output) {
                    return (
                      <div
                        key={`update-doc-error-${toolCallId}`}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error: {String(output.error)}
                      </div>
                    );
                  }

                  return (
                    <div key={`update-doc-output-${toolCallId}`}>
                      <DocumentToolResult
                        type="update"
                        result={output}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-requestSuggestions') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  const { input } = part;
                  return (
                    <div key={`suggestions-input-${toolCallId}`}>
                      <DocumentToolCall
                        type="request-suggestions"
                        args={input}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  if ('error' in output) {
                    return (
                      <div
                        key={`suggestions-error-${toolCallId}`}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error: {String(output.error)}
                      </div>
                    );
                  }

                  return (
                    <div key={`suggestions-output-${toolCallId}`}>
                      <DocumentToolResult
                        type="request-suggestions"
                        result={output}
                        isReadonly={isReadonly}
                      />
                    </div>
                  );
                }
              }

              if (type === 'tool-requestA2AAgent') {
                const { toolCallId, state } = part;

                if (state === 'input-available') {
                  const { input } = part;
                  return (
                    <div key={`a2a-input-${toolCallId}`}>
                      <div className="bg-muted/50 border rounded-xl p-4 w-fit max-w-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="size-4 bg-purple-500 rounded animate-pulse" />
                          <span className="text-sm font-medium">
                            A2A Agent Planning
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Requesting specialized agents for:{' '}
                          {input.userRequirements}
                        </p>
                        <div className="text-xs text-muted-foreground mt-1">
                          Priority: {input.urgency || 'medium'}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  if ('error' in output) {
                    return (
                      <div
                        key={`a2a-error-${toolCallId}`}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error: {String(output.error)}
                      </div>
                    );
                  }

                  // Display Canvas artifact as clickable document
                  if (output.kind === 'canvas') {
                    return (
                      <div key={`a2a-canvas-output-${toolCallId}`}>
                        <DocumentToolResult
                          type="create"
                          result={{
                            id: output.id,
                            title: output.title,
                            kind: output.kind,
                          }}
                          isReadonly={isReadonly}
                        />
                      </div>
                    );
                  }

                  // Handle other A2A outputs
                  return (
                    <div
                      key={`a2a-output-${toolCallId}`}
                      className="bg-green-50 border border-green-200 rounded-xl p-4 w-fit max-w-2xl"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="size-4 bg-green-500 rounded" />
                        <span className="text-sm font-medium">
                          A2A Task Completed
                        </span>
                      </div>
                      <p className="text-sm">
                        {output.content ||
                          `Created ${output.taskCount || 0} tasks`}
                      </p>
                    </div>
                  );
                }
              }

              // Generic handler for MCP and other unknown tool calls
              if (type.startsWith('tool-')) {
                const { toolCallId, state } = part;
                const toolName = type.replace('tool-', '').replace(/_/g, ' ');

                if (state === 'input-available') {
                  return (
                    <div key={`generic-input-${toolCallId}`}>
                      <div className="bg-card text-card-foreground ring-1 ring-border shadow-sm rounded-xl p-4 w-fit max-w-2xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="size-4 bg-blue-500 rounded shadow-sm animate-pulse" />
                          <span className="text-sm font-medium tracking-tight">
                            Consulting {toolName}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Processing your request...
                        </p>
                      </div>
                    </div>
                  );
                }

                if (state === 'output-available') {
                  const { output } = part;

                  // Defensive check: output may be string or structured object
                  if (
                    output &&
                    typeof output === 'object' &&
                    !Array.isArray(output) &&
                    'error' in (output as Record<string, unknown>)
                  ) {
                    return (
                      <div
                        key={`generic-error-${toolCallId}`}
                        className="text-red-500 p-2 border rounded"
                      >
                        Error from {toolName}: {String((output as any).error)}
                      </div>
                    );
                  }

                  // Handle string output (most common for MCP agents)
                  if (typeof output === 'string') {
                    // If output is a JSON string from MCP, try to extract text parts
                    let rendered = output;
                    try {
                      const maybe = JSON.parse(output);
                      if (
                        maybe &&
                        typeof maybe === 'object' &&
                        'result' in maybe &&
                        maybe.result &&
                        typeof maybe.result === 'object' &&
                        'parts' in maybe.result &&
                        Array.isArray((maybe.result as any).parts)
                      ) {
                        const parts = (maybe.result as any).parts as Array<any>;
                        const text = parts
                          .filter((p) => p && (p.text || p.content || p.value))
                          .map((p) => p.text || p.content || p.value)
                          .join('\n\n');
                        if (text && typeof text === 'string') {
                          rendered = text;
                        }
                      }
                    } catch {
                      // not JSON; render as-is
                    }
                    return (
                      <div key={`generic-output-${toolCallId}`}>
                        <div className="bg-card text-card-foreground ring-1 ring-border shadow-sm rounded-xl p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="size-4 bg-green-500 rounded" />
                            <span className="text-sm font-medium tracking-tight">
                              {toolName} Response
                            </span>
                          </div>
                          <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                            <Markdown>{rendered}</Markdown>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Handle object/array output
                  if (typeof output === 'object' && output !== null) {
                    // Prefer text or content fields when present
                    const text =
                      (output as any)?.text || (output as any)?.content;
                    if (typeof text === 'string') {
                      return (
                        <div key={`generic-output-${toolCallId}`}>
                          <div className="bg-card text-card-foreground ring-1 ring-border shadow-sm rounded-xl p-5">
                            <div className="flex items-center gap-2 mb-3">
                              <div className="size-4 bg-green-500 rounded" />
                              <span className="text-sm font-medium tracking-tight">
                                {toolName} Response
                              </span>
                            </div>
                            <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                              <Markdown>{text}</Markdown>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={`generic-output-${toolCallId}`}>
                        <div className="bg-card text-card-foreground ring-1 ring-border shadow-sm rounded-xl p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="size-4 bg-green-500 rounded" />
                            <span className="text-sm font-medium tracking-tight">
                              {toolName} Response
                            </span>
                          </div>
                          <pre className="text-[13px] text-foreground bg-muted/60 ring-1 ring-border/60 p-3 rounded overflow-auto max-h-96">
                            {JSON.stringify(output, null, 2)}
                          </pre>
                        </div>
                      </div>
                    );
                  }

                  // Fallback for other types
                  return (
                    <div key={`generic-output-${toolCallId}`}>
                      <div className="bg-card text-card-foreground ring-1 ring-border shadow-sm rounded-xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="size-4 bg-green-500 rounded" />
                          <span className="text-sm font-medium tracking-tight">
                            {toolName} Response
                          </span>
                        </div>
                        <p className="text-sm text-foreground">
                          {String(output)}
                        </p>
                      </div>
                    </div>
                  );
                }
              }
            })}

            {/* Canvas preview for messages that reference canvas documents */}
            {(() => {
              const canvasPart = message.parts.find(
                (
                  part: any,
                ): part is {
                  type: 'data-canvasReference';
                  data: { artifactType: 'document'; documentId: string };
                } => part.type === 'data-canvasReference',
              );
              return canvasPart ? (
                <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="size-4 bg-blue-500 rounded" />
                    <span className="text-sm font-medium">
                      Task Planning Canvas
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    A canvas has been created to organize and track your tasks.
                    The agent will populate it with tasks and execution results.
                  </p>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Document ID: {canvasPart.data.documentId}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Handle data-task parts for A2A task collection */}
            {(() => {
              const taskParts = message.parts.filter(
                (part: any) => part.type === 'data-task' && part.data?.task,
              );
              return taskParts.length > 0 ? (
                <TaskCollector
                  taskParts={taskParts}
                  chatId={chatId}
                  onCanvasCreated={(canvas) => {
                    // Update the message to include canvas reference
                    setMessages((prevMessages: any[]) =>
                      prevMessages.map((msg) =>
                        msg.id === message.id
                          ? {
                              ...msg,
                              parts: [
                                ...msg.parts,
                                {
                                  type: 'data-canvasReference',
                                  data: {
                                    artifactType: 'document',
                                    documentId: canvas.id,
                                    taskIds: canvas.taskIds,
                                    webhookToken: canvas.webhookToken,
                                  },
                                },
                              ],
                            }
                          : msg,
                      ),
                    );
                  }}
                />
              ) : null;
            })()}

            {!isReadonly && (
              <MessageActions
                key={`action-${message.id}`}
                chatId={chatId}
                message={message}
                vote={vote}
                isLoading={isLoading}
              />
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding)
      return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (!equal(prevProps.vote, nextProps.vote)) return false;

    return false;
  },
);

export const ThinkingMessage = () => {
  const role = 'assistant';

  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="w-full mx-auto max-w-3xl px-4 group/message min-h-96"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
      data-role={role}
    >
      <div
        className={cx(
          'flex gap-4 group-data-[role=user]/message:px-3 w-full group-data-[role=user]/message:w-fit group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl group-data-[role=user]/message:py-2 rounded-xl',
          {
            'group-data-[role=user]/message:bg-muted': true,
          },
        )}
      >
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border">
          <SparklesIcon size={14} />
        </div>

        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 text-muted-foreground">
            Hmm...
          </div>
        </div>
      </div>
    </motion.div>
  );
};
