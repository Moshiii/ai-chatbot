import { auth } from '@/app/(auth)/auth';
import { redirect } from 'next/navigation';
import AgentMarketplace from '@/components/agent-marketplace';
import { PageHeader } from '@/components/page-header';

export default async function Page() {
  const session = await auth();

  if (!session) {
    redirect('/api/auth/guest');
  }

  return (
    <>
      <PageHeader session={session} />
      <AgentMarketplace />
    </>
  );
} 