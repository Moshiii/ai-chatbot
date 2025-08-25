-- Function to handle new user creation for Neon Auth + NextAuth.js integration
-- This function is triggered when a new account is created via OAuth (GitHub)
-- It ensures the User record has proper credit balance initialization
-- User creation and email handling is managed by NextAuth.js callbacks

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
AS $$
BEGIN
  -- Ensure the User record exists with proper credit balance
  -- The actual user creation with email is handled by NextAuth.js JWT callbacks
  INSERT INTO public."User" (
    id,
    email,
    "creditBalance"
  ) VALUES (
    new."userId",
    '', -- Email will be populated by NextAuth.js
    0.00::decimal
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Ensure credit balance is always set for OAuth users
    "creditBalance" = COALESCE(NULLIF(public."User"."creditBalance", ''), 0.00::decimal);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON accounts;

-- Create the trigger that calls this function
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON accounts
  FOR EACH ROW
  WHEN (new.type = 'oauth') -- Only trigger for OAuth accounts
  EXECUTE FUNCTION public.handle_new_user();

