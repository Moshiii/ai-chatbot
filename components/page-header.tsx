'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWindowSize } from 'usehooks-ts';

import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { PlusIcon } from './icons';
import { useSidebar } from './ui/sidebar';
import { memo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { Session } from 'next-auth';

function PurePageHeader({
  session,
  showNewChatButton = false,
}: {
  session: Session;
  showNewChatButton?: boolean;
}) {
  const router = useRouter();
  const { open } = useSidebar();
  const { width: windowWidth } = useWindowSize();

  return (
    <header className="flex sticky top-0 bg-background py-1.5 items-center px-2 md:px-2 gap-2">
      <SidebarToggle />

      {showNewChatButton && (!open || windowWidth < 768) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className="order-2 md:order-1 md:px-2 px-2 md:h-fit ml-auto md:ml-0"
              onClick={() => {
                router.push('/');
                router.refresh();
              }}
            >
              <PlusIcon />
              <span className="md:sr-only">New Chat</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>New Chat</TooltipContent>
        </Tooltip>
      )}

      <div className="order-4 md:ml-auto ml-auto flex gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-950 rounded-md border border-green-200 dark:border-green-800">
          <span className="text-sm font-medium text-green-700 dark:text-green-300">Balance:</span>
          <span className="text-sm font-bold text-green-800 dark:text-green-200">
            {session.user.creditBalance || '0.00'} USDT
          </span>
        </div>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              className="h-fit py-1.5 px-3"
              asChild
            >
              <Link href="/">Chat</Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go to Messages</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              className="h-fit py-1.5 px-3"
              asChild
            >
              <Link href="/marketplace">Marketplace</Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Explore Agent Marketplace</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              className="h-fit py-1.5 px-3"
              asChild
            >
              <Link href="/profile">Profile</Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>View Profile</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

export const PageHeader = memo(PurePageHeader); 