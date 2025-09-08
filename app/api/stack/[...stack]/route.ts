import { StackHandler } from '@stackframe/stack';
import { stackServerApp } from '@/lib/stack';

export const GET = (props: any) => StackHandler({ app: stackServerApp, routeProps: props, fullPage: true });
export const POST = (props: any) => StackHandler({ app: stackServerApp, routeProps: props, fullPage: true });

