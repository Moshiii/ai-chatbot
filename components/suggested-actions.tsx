'use client';

import { motion } from 'framer-motion';
import { Button } from './ui/button';
import { memo } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { VisibilityType } from './visibility-selector';
import type { UIMessage } from 'ai';
import { useSession } from 'next-auth/react';
import { guestRegex } from '@/lib/constants';
import { useRouter } from 'next/navigation';

// Constants for suggested actions
const SUGGESTED_ACTIONS = [
  {
    title: 'Plan a trip',
    label: 'to Japan for 5 days',
    action:
      'Please help me plan a 5-day trip to Japan, including suggested destinations, activities, and a daily itinerary.',
  },
  {
    title: 'Research a topic',
    label: 'about renewable energy',
    action:
      'Research and summarize the latest advancements in renewable energy technologies, focusing on solar and wind power.',
  },
] as const;

interface SuggestedActionsProps {
  chatId: string;
  sendMessage: UseChatHelpers<UIMessage>['sendMessage'];
  selectedVisibilityType: VisibilityType;
}

function PureSuggestedActions({
  chatId,
  sendMessage,
  selectedVisibilityType,
}: SuggestedActionsProps) {
  const { data: session } = useSession();
  const router = useRouter();

  const isGuest = guestRegex.test(session?.user?.email ?? '');

  const handleSuggestedAction = async (action: string) => {
    // Redirect guest users to login when they try to use suggestions
    if (isGuest) {
      router.push('/login');
      return;
    }

    window.history.replaceState({}, '', `/chat/${chatId}`);

    sendMessage({
      role: 'user',
      parts: [{ type: 'text', text: action }],
    });
  };

  return (
    <div
      data-testid="suggested-actions"
      className="grid sm:grid-cols-2 gap-2 w-full"
    >
      {SUGGESTED_ACTIONS.map((suggestedAction, index) => (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
          key={`suggested-action-${suggestedAction.title}-${index}`}
          className={index > 1 ? 'hidden sm:block' : 'block'}
        >
          <Button
            variant="ghost"
            onClick={() => handleSuggestedAction(suggestedAction.action)}
            className="text-left border rounded-xl px-4 py-3.5 text-sm flex-1 gap-1 sm:flex-col w-full h-auto justify-start items-start"
          >
            <span className="font-medium">{suggestedAction.title}</span>
            <span className="text-muted-foreground">
              {suggestedAction.label}
            </span>
          </Button>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) return false;
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType)
      return false;

    return true;
  },
);
