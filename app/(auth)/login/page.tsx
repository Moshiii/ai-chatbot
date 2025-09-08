'use client';

import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { GitHubIcon } from '@/components/icons';
import { useStackApp } from '@stackframe/stack';
import { useRouter } from 'next/navigation';

export default function Page() {
  const stackApp = useStackApp();
  const router = useRouter();

  const handleGitHubSignIn = async () => {
    try {
      await stackApp.signInWithOAuth('github');
      router.push('/');
    } catch (error) {
      console.error('GitHub sign-in error:', error);
      toast({
        type: 'error',
        description: 'Failed to sign in with GitHub!',
      });
    }
  };

  return (
    <div className="flex h-dvh w-screen items-start pt-12 md:pt-0 md:items-center justify-center bg-background">
      <div className="w-full max-w-md overflow-hidden rounded-2xl flex flex-col gap-12">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          <h3 className="text-xl font-semibold dark:text-zinc-50">Sign In</h3>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Sign in with your GitHub account
          </p>
        </div>

        {/* GitHub Sign In Button */}
        <div className="px-4 sm:px-16">
          <Button
            onClick={handleGitHubSignIn}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white flex items-center justify-center gap-2"
            variant="outline"
          >
            <GitHubIcon />
            Continue with GitHub
          </Button>
        </div>
      </div>
    </div>
  );
}
