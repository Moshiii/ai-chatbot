# Database Functions

This directory contains SQL functions and triggers that need to be applied to your PostgreSQL database.

## Directory Structure

- `00_handle_new_user.sql` - Example function that creates a user record when a new auth user is created
- `README.md` - This documentation file

## File Naming Convention

Files are prefixed with numbers to ensure proper execution order:

- `00_` - Core functions and triggers
- `01_` - Secondary functions
- etc.

## Running Functions

Use the bootstrap script to apply all SQL functions:

```bash
# Using npm script
pnpm db:bootstrap-functions

# Or directly
npx tsx lib/db/bootstrap-functions.ts
```

## Adding New Functions

1. Create a new `.sql` file with the appropriate numeric prefix
2. Include all necessary SQL statements (functions, triggers, etc.)
3. Test the function locally
4. Run the bootstrap script to apply it

## Example Function Structure

```sql
-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public."User" (id, email, "creditBalance")
  VALUES (new.id, new.email, '0.00')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger that calls this function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

## Best Practices

1. **Security**: Use `SECURITY DEFINER` for functions that need elevated privileges
2. **Search Path**: Set `search_path = ''` to avoid search_path attacks
3. **Error Handling**: Include proper error handling in your functions
4. **Testing**: Test functions thoroughly before deploying to production
5. **Documentation**: Document the purpose and parameters of each function
