import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import { requireCurrentAppUser } from '@/lib/stack-auth';
import type { UserType } from '@/lib/ai/entitlements';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/utils';
import { generateChatIds } from '@/lib/id-management';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { requestA2AAgent } from '@/lib/ai/tools/request-a2a-agent';

import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
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

    const user = await requireCurrentAppUser();
    const session = { user: { id: user.id, type: 'regular' as UserType } };

    const userType: UserType = 'regular';

    const messageCount = await getMessageCountByUserId({
      id: user.id,
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
        userId: user.id,
        title,
        visibility: selectedVisibilityType,
        ownerId: user.stackUserId || user.id,
      });
    } else {
      if (chat.userId !== user.id) {
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

    const chatIds = generateChatIds();
    const streamId = chatIds.generateStreamId().databaseId;
    await createStreamId({ streamId, chatId: id });

    // Always use regular model provider (simplified architecture)
    const modelProvider = myProvider.languageModel(selectedChatModel);

    console.log(
      `[Chat API] Using regular model provider: ${selectedChatModel}`,
    );

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: modelProvider,
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === 'chat-model-reasoning'
              ? [] // No tools for reasoning mode
              : [
                  'getWeather',
                  'createDocument', // Keep for non-task workflows
                  'updateDocument',
                  'requestSuggestions',
                  'requestA2AAgent', // Integrated tool for A2A agent communication + task management
                ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools:
            selectedChatModel === 'chat-model-reasoning'
              ? {} // No tools for reasoning mode
              : {
                  getWeather,
                  createDocument: createDocument({ session, dataStream }),
                  updateDocument: updateDocument({ session, dataStream }),
                  requestSuggestions: requestSuggestions({
                    session,
                    dataStream,
                  }),
                  requestA2AAgent: requestA2AAgent({ session, dataStream }), // Integrated A2A communication + task management tool
                },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        console.log(
          `[Chat API] Stream configuration for ${selectedChatModel}:`,
          {
            modelProvider: modelProvider?.modelId || 'unknown',
            toolsDisabled: selectedChatModel === 'chat-model-reasoning',
            activeToolsCount:
              selectedChatModel === 'chat-model-reasoning' ? 0 : 5,
            toolsObject:
              selectedChatModel === 'chat-model-reasoning'
                ? 'empty'
                : 'populated',
            hasA2ATool: selectedChatModel !== 'chat-model-reasoning',
            integratedTaskFlow: selectedChatModel !== 'chat-model-reasoning',
          },
        );

        result.consumeStream();

        console.log(
          '[Chat API] 🔄 Merging result stream with UI message stream',
        );
        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
            originalMessages: uiMessages, // Required for AI SDK v5 proper artifact creation
          }),
        );
        console.log('[Chat API] ✅ Stream merge completed');
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

  const user = await requireCurrentAppUser();

  const chat = await getChatById({ id });

  if (chat.userId !== user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
