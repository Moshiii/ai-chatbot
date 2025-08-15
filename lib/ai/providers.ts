import { customProvider, extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';
import { isTestEnvironment } from '../constants';
import { a2a } from './a2a-provider';
import { A2A_CHAT_MODEL_ID } from './models';

const enableA2A = process.env.ENABLE_A2A === 'true';
const a2aUrl = process.env.A2A_AGENT_URL;

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
        ...(enableA2A && a2aUrl
          ? {
              [A2A_CHAT_MODEL_ID]: a2a(a2aUrl, {
                maxHistoryLength: 5,
                maxRetries: 2,
              }),
            }
          : {}),
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': openai('gpt-4o'),
        'chat-model-reasoning': wrapLanguageModel({
          model: openai('gpt-4o'),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'title-model': openai('gpt-4o'),
        'artifact-model': openai('gpt-4o'),
        ...(enableA2A && a2aUrl
          ? {
              [A2A_CHAT_MODEL_ID]: a2a(a2aUrl, {
                maxHistoryLength: 5,
                maxRetries: 2,
              }),
            }
          : {}),
      },
      imageModels: {
        'small-model': openai.imageModel('dall-e-3'),
      },
    });
