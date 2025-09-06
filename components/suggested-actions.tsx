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
    title: 'Analyze market trends',
    label: 'for renewable energy stocks',
    action:
      'Analyze current market trends and provide a detailed report on renewable energy stocks, including performance metrics and investment insights. Use our agent tool to break this down into comprehensive market analysis tasks.',
  },
  {
    title: 'Find trending topics',
    label: 'on social media today',
    action:
      'Search for and analyze the top trending topics on social media platforms today. Use our agent tool to organize this into structured trend analysis.',
  },
  {
    title: 'Plan a complex project',
    label: 'with task decomposition',
    action:
      'Help me plan a comprehensive software development project. Use our agent tool to intelligently break this down into specific, actionable tasks with appropriate agent assignments.',
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
      className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 w-full"
    >
      {SUGGESTED_ACTIONS.map((suggestedAction, index) => (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
          key={`suggested-action-${suggestedAction.title}-${index}`}
          className="block"
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
