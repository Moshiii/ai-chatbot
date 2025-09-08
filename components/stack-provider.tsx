'use client';

import { StackProvider as StackFrameProvider } from '@stackframe/stack';
import { stackApp } from '@/lib/stack-client';

interface StackProviderProps {
  children: React.ReactNode;
}

export function StackProvider({ children }: StackProviderProps) {
  return <StackFrameProvider app={stackApp}>{children}</StackFrameProvider>;
}
