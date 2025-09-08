import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/page-header';
import Image from 'next/image';
import { getCurrentAppUser } from '@/lib/stack-auth';

export default async function ProfilePage() {
  const user = await getCurrentAppUser();

  if (!user) {
    redirect('/login');
  }

  const session = { user: { id: user.id, type: 'regular' as const } };

  return (
    <>
      <PageHeader session={session} />
      <div className="container mx-auto py-8 px-4 max-w-2xl">
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
            <p className="text-muted-foreground">Your account information</p>
          </div>

          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4">
                <Image
                  src={`https://avatar.vercel.sh/${user.email}`}
                  alt={user.email ?? 'User Avatar'}
                  width={80}
                  height={80}
                  className="rounded-full border-4 border-border"
                />
              </div>
              <CardTitle className="text-xl">{user.email}</CardTitle>
              <CardDescription>
                <Badge variant="default">GitHub User</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Separator />
              <div className="grid gap-4">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Email:</span>
                  <span>{user.email}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Account Type:</span>
                  <Badge variant="outline">Regular</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium text-muted-foreground">Credit Balance:</span>
                  <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                    {user.creditBalance || '0.00'} USDT
                  </Badge>
                </div>
                {user.name && (
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-muted-foreground">Name:</span>
                    <span>{user.name}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
