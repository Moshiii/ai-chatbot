import 'server-only';
import { StackServerApp } from '@stackframe/stack';

if (!process.env.STACK_SECRET_SERVER_KEY) {
  throw new Error(
    'Missing required STACK_SECRET_SERVER_KEY environment variable',
  );
}

if (!process.env.NEXT_PUBLIC_STACK_PROJECT_ID) {
  throw new Error(
    'Missing required NEXT_PUBLIC_STACK_PROJECT_ID environment variable',
  );
}

export const stackServerApp = new StackServerApp({
  tokenStore: 'nextjs-cookie',
  projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
});
