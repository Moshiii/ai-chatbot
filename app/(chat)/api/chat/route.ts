import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai";
import { unstable_cache as cache } from "next/cache";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";
import type { ModelCatalog } from "tokenlens/core";
import { fetchModels } from "tokenlens/fetch";
import { getUsage } from "tokenlens/helpers";
import { auth, type UserType } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/visibility-selector";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import type { ChatModel } from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { myProvider } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
  updateChatTitleById,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { convertToUIMessages, generateUUID, getTextFromMessage } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

const getTokenlensCatalog = cache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch (err) {
      console.warn(
        "TokenLens: catalog fetch failed, using default catalog",
        err
      );
      return; // tokenlens helpers will fall back to defaultCatalog
    }
  },
  ["tokenlens-catalog"],
  { revalidate: 24 * 60 * 60 } // 24 hours
);

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes("REDIS_URL")) {
        console.log(
          " > Resumable streams are disabled due to missing REDIS_URL"
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  const startTime = performance.now();
  const timings: Record<string, number> = {};
  let lastTime = startTime;

  const logTiming = (label: string) => {
    const now = performance.now();
    const elapsed = now - lastTime;
    timings[label] = elapsed;
    console.log(`[TIMING] ${label}: ${elapsed.toFixed(2)}ms`);
    lastTime = now;
  };

  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
    logTiming("1. Request parsing");
  } catch (_) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel["id"];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();
    logTiming("2. Authentication");

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });
    logTiming("3. Message count check");

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const chat = await getChatById({ id });
    logTiming("4. Chat lookup");
    let messagesFromDb: DBMessage[] = [];

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      // Only fetch messages if chat already exists
      messagesFromDb = await getMessagesByChatId({ id });
      logTiming("5. Fetch messages from DB");
    } else {
      const title = await generateTitleFromUserMessage({
        message,
      });
      logTiming("5. Generate title (new chat)");

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
      logTiming("6. Save new chat");
      // New chat - no need to fetch messages, it's empty
    }

    const uiMessages = [...convertToUIMessages(messagesFromDb), message];
    logTiming("7. Convert to UI messages");

    const { longitude, latitude, city, country } = geolocation(request);
    logTiming("8. Geolocation");

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
          role: "user",
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });
    logTiming("9. Save user message");

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });
    logTiming("10. Create stream ID");

    let finalMergedUsage: AppUsage | undefined;

    console.log("[TIMING] Starting MCP client creation...");
    let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
    let mcp_tools: Record<string, unknown> = {};
    
    try {
      // Add timeout to MCP client creation to prevent blocking
      const mcpClientPromise = createMCPClient({
        transport: {
          type: 'http',
          url: 'http://127.0.0.1:8000/mcp',

          // optional: configure HTTP headers
          // headers: { Authorization: 'Bearer my-api-key' },

          // optional: provide an OAuth client provider for automatic authorization
          // authProvider: myOAuthClientProvider,
        },
      });
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("MCP client creation timeout")), 5000); // 5 second timeout
      });
      
      mcpClient = await Promise.race([mcpClientPromise, timeoutPromise]);
      logTiming("11. Create MCP client");
      
      console.log("[TIMING] Fetching MCP tools...");
      const toolsPromise = mcpClient.tools();
      const toolsTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("MCP tools fetch timeout")), 5000); // 5 second timeout
      });
      
      mcp_tools = await Promise.race([toolsPromise, toolsTimeoutPromise]);
      logTiming("12. Fetch MCP tools");
    } catch (err) {
      console.warn("[TIMING] MCP client creation/tools fetch failed or timed out:", err);
      logTiming("11-12. MCP client (failed/timeout)");
      // Continue without MCP tools - the stream will work without them
    }
    
    console.log("[TIMING] Creating stream...");
    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        console.log("[TIMING] Stream execute started");
        const streamTextStart = performance.now();
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === "chat-model-reasoning"
              ? []
              : [
                  "requestSuggestions",
                ],
          experimental_transform: smoothStream({ chunking: "word" }),
          tools: {
            // getWeather,
            // createDocument: createDocument({ session, dataStream }),
            // updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
            ...mcp_tools,
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
          onFinish: async ({ usage }) => {
            const onFinishStart = performance.now();
            console.log("[TIMING] onFinish callback started");
            try {
              const providers = await getTokenlensCatalog();
              const modelId =
                myProvider.languageModel(selectedChatModel).modelId;
              if (!modelId) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              if (!providers) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }
              if (mcpClient) {
                await mcpClient.close();
              }
              const summary = getUsage({ modelId, usage, providers });
              finalMergedUsage = { ...usage, ...summary, modelId } as AppUsage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
              console.log(`[TIMING] onFinish completed: ${(performance.now() - onFinishStart).toFixed(2)}ms`);
            } catch (err) {
              console.warn("TokenLens enrichment failed", err);
              finalMergedUsage = usage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            }
          },
        });

        const streamTextElapsed = performance.now() - streamTextStart;
        console.log(`[TIMING] streamText() call completed: ${streamTextElapsed.toFixed(2)}ms`);

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          })
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        const streamOnFinishStart = performance.now();
        console.log("[TIMING] Stream onFinish callback started");
        await saveMessages({
          messages: messages.map((currentMessage) => ({
            id: currentMessage.id,
            role: currentMessage.role,
            parts: currentMessage.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          })),
        });
        console.log(`[TIMING] Save assistant messages: ${(performance.now() - streamOnFinishStart).toFixed(2)}ms`);

        if (finalMergedUsage) {
          try {
            await updateChatLastContextById({
              chatId: id,
              context: finalMergedUsage,
            });
            console.log(`[TIMING] Update chat context: ${(performance.now() - streamOnFinishStart).toFixed(2)}ms`);
          } catch (err) {
            console.warn("Unable to persist last usage for chat", id, err);
          }
        }
      },
      onError: () => {
        return "Oops, an error occurred!";
      },
    });
    logTiming("13. Create UI message stream");

    // const streamContext = getStreamContext();

    // if (streamContext) {
    //   return new Response(
    //     await streamContext.resumableStream(streamId, () =>
    //       stream.pipeThrough(new JsonToSseTransformStream())
    //     )
    //   );
    // }

    const totalTime = performance.now() - startTime;
    console.log("\n[TIMING SUMMARY]");
    console.log("==================");
    Object.entries(timings).forEach(([label, time]) => {
      const percentage = ((time / totalTime) * 100).toFixed(1);
      console.log(`${label}: ${time.toFixed(2)}ms (${percentage}%)`);
    });
    console.log(`TOTAL TIME BEFORE STREAM: ${totalTime.toFixed(2)}ms`);
    console.log("==================\n");

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    // Check for Vercel AI Gateway credit card error
    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatSDKError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
