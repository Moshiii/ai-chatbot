'use client';
import { StackClientApp } from '@stackframe/stack';

if (!process.env.NEXT_PUBLIC_STACK_PROJECT_ID) {
  throw new Error(
    'Missing required NEXT_PUBLIC_STACK_PROJECT_ID environment variable',
  );
}

if (!process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY) {
  throw new Error(
    'Missing required NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY environment variable',
  );
}

export const stackApp = new StackClientApp({
  projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: 'nextjs-cookie',
});
