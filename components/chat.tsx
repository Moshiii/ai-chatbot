'use client';

import { DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import type { Vote } from '@/lib/db/schema';
import { fetcher, fetchWithErrorHandlers, generateUUID } from '@/lib/utils';
import { Artifact } from './artifact';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { useArtifactSelector } from '@/hooks/use-artifact';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import type { Session } from 'next-auth';
import { useSearchParams } from 'next/navigation';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { ChatSDKError } from '@/lib/errors';
import type { Attachment } from '@/lib/types';
import { useDataStream } from './data-stream-provider';
import type { UIMessage } from 'ai';

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  session,
  autoResume,
}: {
  id: string;
  initialMessages: UIMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: Session;
  autoResume: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>('');
  const [collectedTasks, setCollectedTasks] = useState<any[]>([]);
  const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(
    new Set(),
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<UIMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));

      // Handle task data collection for A2A canvas creation
      // Check if this data part has tool-related properties (from A2A provider)
      const toolDataPart = dataPart as any;
      if (
        toolDataPart?.toolName === 'task-generation' &&
        toolDataPart?.result &&
        toolDataPart?.type === 'tool-result'
      ) {
        console.log(
          '[Chat] Received task generation result:',
          toolDataPart.result,
        );
        setCollectedTasks((prev) => {
          // Check if we already have this task to avoid duplicates
          const exists = prev.some(
            (task) => task.id === toolDataPart.result.id,
          );
          if (!exists) {
            return [...prev, toolDataPart.result];
          }
          return prev;
        });
      }
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      }
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: 'user' as const,
        parts: [{ type: 'text', text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, '', `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Array<Vote>>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher,
  );

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  // Task collection and canvas creation effect
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || !collectedTasks.length) return;

    // Check if we've already processed this message
    if (processedMessageIds.has(lastMessage.id)) return;

    // Check if the last message is from assistant (meaning agent has finished responding)
    if (lastMessage.role === 'assistant') {
      console.log(
        '[Chat] Processing collected tasks for canvas creation:',
        collectedTasks,
      );

      // Call canvas creation API with retry logic
      const createCanvasWithRetry = async (attempt = 1, maxRetries = 3) => {
        try {
          console.log(
            `[Chat] Attempting canvas creation (attempt ${attempt}/${maxRetries})`,
          );

          const response = await fetch('/api/canvas/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tasks: collectedTasks,
              chatId: id,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `HTTP ${response.status}: ${response.statusText} - ${errorText}`,
            );
          }

          const result = await response.json();
          console.log('[Chat] Canvas created successfully:', result);

          // Mark this message as processed to prevent duplicate API calls
          setProcessedMessageIds((prev) => new Set(prev).add(lastMessage.id));

          // Clear collected tasks
          setCollectedTasks([]);

          toast({
            type: 'success',
            description: `Created canvas with ${collectedTasks.length} tasks`,
          });

          return result;
        } catch (error) {
          console.error(
            `[Chat] Canvas creation attempt ${attempt} failed:`,
            error,
          );

          if (attempt < maxRetries) {
            const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
            console.log(
              `[Chat] Retrying canvas creation in ${retryDelay}ms...`,
            );

            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            return createCanvasWithRetry(attempt + 1, maxRetries);
          }

          // Final failure - show error but don't prevent future attempts
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          toast({
            type: 'error',
            description: `Failed to create task canvas after ${maxRetries} attempts: ${errorMessage}`,
          });

          // Still mark as processed to avoid infinite retries on the same message
          setProcessedMessageIds((prev) => new Set(prev).add(lastMessage.id));
          setCollectedTasks([]);

          throw error;
        }
      };

      const createCanvas = async () => {
        try {
          await createCanvasWithRetry();
        } catch (error) {
          // Error already handled in retry function
          console.error('[Chat] Canvas creation ultimately failed:', error);
        }
      };

      createCanvas();
    }
  }, [messages, collectedTasks, processedMessageIds, id]);

  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          chatId={id}
          selectedModelId={initialChatModel}
          selectedVisibilityType={initialVisibilityType}
          isReadonly={isReadonly}
          session={session}
        />

        <Messages
          chatId={id}
          status={status}
          votes={votes}
          messages={messages}
          setMessages={setMessages}
          regenerate={regenerate}
          isReadonly={isReadonly}
          isArtifactVisible={isArtifactVisible}
        />

        <form className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl">
          {!isReadonly && (
            <MultimodalInput
              chatId={id}
              input={input}
              setInput={setInput}
              status={status}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              sendMessage={sendMessage}
              selectedVisibilityType={visibilityType}
            />
          )}
        </form>
      </div>

      <Artifact
        chatId={id}
        input={input}
        setInput={setInput}
        status={status}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        sendMessage={sendMessage}
        messages={messages}
        setMessages={setMessages}
        regenerate={regenerate}
        votes={votes}
        isReadonly={isReadonly}
        selectedVisibilityType={visibilityType}
      />
    </>
  );
}
