import type { UserType } from '@/app/(auth)/auth';
import type { ChatModel } from './models';
import { A2A_CHAT_MODEL_ID } from './models';

interface Entitlements {
  maxMessagesPerDay: number;
  availableChatModelIds: Array<ChatModel['id']>;
}

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account
   */
  guest: {
    maxMessagesPerDay: 20,
    availableChatModelIds: ['chat-model', 'chat-model-reasoning', A2A_CHAT_MODEL_ID],
  },

  /*
   * For users with an account
   */
  regular: {
    maxMessagesPerDay: 100,
    availableChatModelIds: ['chat-model', 'chat-model-reasoning', A2A_CHAT_MODEL_ID],
  },

  /*
   * TODO: For users with an account and a paid membership
   */
};
