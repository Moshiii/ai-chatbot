# Stack Auth Environment Setup

This document outlines the environment variables required for Stack Auth integration with Neon Auth.

## Required Environment Variables

Add the following environment variables to your `.env.local` file:

### Stack Auth Configuration

```env
# Stack Auth Project Configuration (from Neon Console → Auth or Stack Dashboard)
NEXT_PUBLIC_STACK_PROJECT_ID=your_stack_project_id_here
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=your_publishable_client_key_here
STACK_SECRET_SERVER_KEY=your_secret_server_key_here
```

### Database Configuration

```env
# Neon Database URLs
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
DATABASE_AUTHENTICATED_URL=postgresql://authenticated_user:password@host/database?sslmode=require
```

### Legacy Configuration (remove after migration)

The following Auth.js variables can be removed after the migration is complete:

```env
# These will be removed in Phase 3
AUTH_SECRET=your_auth_secret_here
AUTH_GITHUB_ID=your_github_app_id_here
AUTH_GITHUB_SECRET=your_github_app_secret_here
```

## How to Get Stack Auth Credentials

### Option 1: Through Neon Console (Recommended)

1. Go to your Neon Console
2. Navigate to your project
3. Click on "Auth" in the sidebar
4. Click "Set up Auth" to create a Stack project
5. Copy the generated credentials

### Option 2: Through Stack Dashboard

1. Go to https://app.stack-auth.com/
2. Create a new project or use an existing one
3. Go to project settings
4. Copy the required credentials

## Environment Setup Steps

1. **Copy environment variables**: Add all required variables to your `.env.local` file
2. **Install dependencies**: Run `pnpm install` to install Stack Auth packages
3. **Run migrations**: Execute `pnpm run db:migrate` to apply database schema changes
4. **Test authentication**: Try logging in with GitHub through the new Stack Auth flow

## Database Migration

The migration adds the following columns:

- `user.stack_user_id` - Links app users to Stack user IDs
- `chat.owner_id`, `document.owner_id`, `vote.owner_id`, `suggestion.owner_id` - For Row Level Security

Run the migration with:

```bash
pnpm run db:migrate
```

## Row Level Security (RLS)

After the basic setup, RLS policies need to be applied to the database. This is typically done through SQL commands in the Neon Console or via a database admin tool.

The RLS policies will ensure that:

- Users can only access their own chats, documents, votes, and suggestions
- Data is automatically filtered based on the authenticated user's Stack ID

## Testing the Setup

1. **Start the development server**: `pnpm dev`
2. **Navigate to `/login`**: Should show GitHub sign-in button
3. **Sign in with GitHub**: Should create or link a user account
4. **Check database**: Verify user record has `stack_user_id` populated
5. **Test protected routes**: Ensure authentication works correctly

## Troubleshooting

### Common Issues

1. **"Missing required environment variable" error**
   - Ensure all Stack Auth environment variables are set correctly
   - Check that variables are in `.env.local` and restart the dev server

2. **"Failed to get current Stack user" error**
   - Verify Stack Auth credentials are correct
   - Check Neon Console or Stack Dashboard for project configuration

3. **Database connection errors**
   - Ensure `DATABASE_URL` is correctly formatted
   - Verify database is accessible and credentials are valid

4. **Authentication redirect loops**
   - Check middleware configuration
   - Ensure `/api/stack` routes are properly excluded from auth checks

### Debugging

Enable debug logging by setting:

```env
NODE_ENV=development
```

Check browser developer tools and server logs for additional error information.

## Migration Timeline

- **Phase 1**: Stack Auth setup alongside existing Auth.js (current)
- **Phase 2**: Database schema updates and RLS policies
- **Phase 3**: Remove Auth.js dependencies and legacy tables

## Support

For Stack Auth specific issues, refer to:

- [Stack Auth Documentation](https://docs.stack-auth.com/)
- [Neon Auth Documentation](https://neon.tech/docs/guides/auth-with-stack-auth)

