import { getCurrentAppUser } from '@/lib/stack-auth';
import { redirect } from 'next/navigation';
import AgentMarketplace from '@/components/agent-marketplace';
import { PageHeader } from '@/components/page-header';

export default async function Page() {
  const user = await getCurrentAppUser();

  if (!user) {
    redirect('/login');
  }

  const session = { user: { id: user.id, type: 'regular' as const } };

  return (
    <>
      <PageHeader session={session} />
      <AgentMarketplace />
    </>
  );
}
