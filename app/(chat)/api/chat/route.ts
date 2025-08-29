import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  saveDocument,
} from '@/lib/db/queries';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateChatIds, generateDocumentIds } from '@/lib/id-management';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';

import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { a2a } from '@/lib/ai/a2a-provider';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { UIMessage } from 'ai';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (
        error.message.includes('REDIS_URL') ||
        error.message.includes('Invalid URL')
      ) {
        console.log(
          ' > Resumable streams are disabled due to missing or invalid REDIS_URL',
        );
      } else {
        console.error('Error creating resumable stream context:', error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const responseBody = await request.json();
    requestBody = postRequestBodySchema.parse(responseBody);
  } catch (error) {
    console.error('Request validation error:', error);
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: UIMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const userType: UserType = session.user.type || 'guest';

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError('rate_limit:chat').toResponse();
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    // Handle A2A model - create canvas document and configure webhook
    let canvasDocumentId: string | null = null;
    let webhookToken: string | null = null;

    if (selectedChatModel === 'a2a-model') {
      // Generate IDs for canvas document
      const documentIds = generateDocumentIds('Task Planning Canvas', 'canvas');
      canvasDocumentId = documentIds.document.databaseId;

      // Generate webhook token for A2A notifications
      webhookToken = generateUUID();

      // Create canvas document
      if (!canvasDocumentId) {
        throw new Error('Failed to generate canvas document ID');
      }

      await saveDocument({
        id: canvasDocumentId,
        title: 'Task Planning Canvas',
        kind: 'canvas',
        content: 'Planning tasks...',
        userId: session.user.id,
      });

      // Store canvas reference in user message
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: 'user',
            parts: [
              ...message.parts,
              {
                type: 'data-canvasReference',
                data: {
                  artifactType: 'document',
                  documentId: canvasDocumentId,
                },
              },
            ],
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const chatIds = generateChatIds();
    const streamId = chatIds.generateStreamId().databaseId;
    await createStreamId({ streamId, chatId: id });

    // Select the appropriate model provider
    let modelProvider: any;
    if (selectedChatModel === 'a2a-model') {
      // Configure A2A provider with webhook settings
      const a2aAgentUrl = process.env.A2A_AGENT_URL;
      if (!a2aAgentUrl) {
        throw new Error(
          'A2A_AGENT_URL environment variable is required for A2A model',
        );
      }

      modelProvider = a2a(a2aAgentUrl, {
        chatId: id,
        contextId: id, // Use chatId as contextId
        taskMode: true,
        pushNotificationConfig: webhookToken
          ? {
              url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhook/tasks`,
              token: webhookToken,
            }
          : undefined,
        // Include canvas document ID in settings for the agent to use
        documentId: canvasDocumentId || undefined,
      });
    } else {
      modelProvider = myProvider.languageModel(selectedChatModel);
    }

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: modelProvider,
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === 'chat-model-reasoning'
              ? []
              : [
                  'getWeather',
                  'createDocument', // Keep for non-task workflows
                  'updateDocument',
                  'requestSuggestions',
                ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
            originalMessages: uiMessages, // Fix for AI SDK v5 to prevent repeated assistant messages with tools
          }),
        );
      },
      generateId: () => chatIds.generateMessageId().databaseId,
      onFinish: async ({ messages }) => {
        await saveMessages({
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            parts: message.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          })),
        });
      },
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()),
        ),
      );
    } else {
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error('Unexpected error in chat route:', error);
    return new ChatSDKError('bad_request:chat').toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
