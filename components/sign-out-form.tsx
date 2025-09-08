import Form from 'next/form';
import { redirect } from 'next/navigation';

import { getCurrentAppUser } from '@/lib/stack-auth';

export const SignOutForm = () => {
  return (
    <Form
      className="w-full"
      action={async () => {
        'use server';

        const user = await getCurrentAppUser();
        if (user) {
          // Redirect to Stack Auth sign out handler
          redirect('/api/stack/sign-out');
        }
      }}
    >
      <button
        type="submit"
        className="w-full text-left px-1 py-0.5 text-red-500"
      >
        Sign out
      </button>
    </Form>
  );
};
