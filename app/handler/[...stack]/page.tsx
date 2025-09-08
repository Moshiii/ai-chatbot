import { StackHandler } from '@stackframe/stack';
import { stackServerApp } from '@/lib/stack';

export default function Page(props: any) {
  return StackHandler({
    app: stackServerApp,
    routeProps: props,
    fullPage: true,
  });
}
