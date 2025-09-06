import { type NextRequest, NextResponse } from 'next/server';
import { createUser, getUser } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return new ChatSDKError(
        'bad_request:api',
        'Email and password are required',
      ).toResponse();
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new ChatSDKError(
        'bad_request:api',
        'Invalid email format',
      ).toResponse();
    }

    // Validate password strength
    if (password.length < 6) {
      return new ChatSDKError(
        'bad_request:api',
        'Password must be at least 6 characters long',
      ).toResponse();
    }

    // Check if user already exists
    const [existingUser] = await getUser(email);
    if (existingUser) {
      return new ChatSDKError(
        'bad_request:api',
        'User with this email already exists',
      ).toResponse();
    }

    // Create new user
    const newUser = await createUser(email, password);

    return NextResponse.json(
      {
        success: true,
        message: 'User registered successfully',
        user: {
          id: newUser.id,
          email: newUser.email,
          creditBalance: newUser.creditBalance,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Registration error:', error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      'bad_request:api',
      'Failed to register user',
    ).toResponse();
  }
}
