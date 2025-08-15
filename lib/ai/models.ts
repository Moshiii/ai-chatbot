export const DEFAULT_CHAT_MODEL: string = 'chat-model';
export const A2A_CHAT_MODEL_ID: string = 'a2a-model';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
}

const baseModels: Array<ChatModel> = [
  {
    id: 'chat-model',
    name: 'Chat model',
    description: 'Primary model for all-purpose chat',
  },
  {
    id: 'chat-model-reasoning',
    name: 'Reasoning model',
    description: 'Uses advanced reasoning',
  },
];

// Conditionally expose the A2A model option in the UI when enabled.
// Uses NEXT_PUBLIC_ so it can be evaluated client-side safely.
const enableA2A = process.env.NEXT_PUBLIC_ENABLE_A2A === 'true';

export const chatModels: Array<ChatModel> = enableA2A
  ? [
      ...baseModels,
      {
        id: A2A_CHAT_MODEL_ID,
        name: 'Python Agent (A2A)',
        description: 'Routes requests to your Python A2A agent',
      },
    ]
  : baseModels;
