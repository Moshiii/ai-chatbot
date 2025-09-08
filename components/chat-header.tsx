'use client';

import { memo } from 'react';
import { ModelSelector } from '@/components/model-selector';
import { type VisibilityType, VisibilitySelector } from './visibility-selector';
import type { AppSession } from '@/lib/types';
import { PageHeader } from './page-header';

function PureChatHeader({
  chatId,
  selectedModelId,
  selectedVisibilityType,
  isReadonly,
  session,
}: {
  chatId: string;
  selectedModelId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: AppSession;
}) {
  return (
    <PageHeader 
      session={session}
      showBalance={true}
      showNavigation={true}
    >
      {/* Chat-specific components */}
      {!isReadonly && (
        <ModelSelector
          session={session}
          selectedModelId={selectedModelId}
          className="order-1 md:order-2"
        />
      )}

      {!isReadonly && (
        <VisibilitySelector
          chatId={chatId}
          selectedVisibilityType={selectedVisibilityType}
          className="order-1 md:order-3"
        />
      )}
    </PageHeader>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return prevProps.selectedModelId === nextProps.selectedModelId;
});
