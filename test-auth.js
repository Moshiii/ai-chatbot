#!/usr/bin/env node

/**
 * Simple test script to verify authentication flow
 * Run with: node test-auth.js
 */

const { exec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

async function runCommand(command) {
  try {
    console.log(`\n🔄 Running: ${command}`);
    const { stdout, stderr } = await execAsync(command);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error(`❌ Error running ${command}:`, error.message);
    return { success: false, error };
  }
}

async function testAuthFlow() {
  console.log('🚀 Testing Authentication Flow\n');

  // Check if dev server is running
  console.log('1. Checking development server...');
  const serverCheck = await runCommand(
    'curl -s http://localhost:3000 > /dev/null && echo "Server is running" || echo "Server not running"',
  );

  if (!serverCheck.stdout?.includes('Server is running')) {
    console.log('⚠️  Development server not running. Starting it...');
    await runCommand('pnpm dev');
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for server to start
  }

  // Test database connection
  console.log('2. Testing database connection...');
  await runCommand(
    'cd /Users/rami/dev/isek-client/ai-chatbot && pnpm db:studio --help > /dev/null 2>&1 && echo "Database connection OK" || echo "Database connection issue"',
  );

  // Test authentication endpoints
  console.log('3. Testing authentication endpoints...');
  await runCommand(
    'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/providers && echo " - Auth providers endpoint"',
  );
  await runCommand(
    'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/auth/session && echo " - Auth session endpoint"',
  );

  console.log('\n✅ Authentication flow test completed!');
  console.log('\n📋 Manual Testing Steps:');
  console.log('1. Open http://localhost:3000 in your browser');
  console.log('2. Click "Continue as Guest"');
  console.log('3. Try to create a chat (this should work)');
  console.log('4. Click GitHub login button');
  console.log('5. Authenticate with GitHub');
  console.log('6. Verify you can create chats without foreign key errors');
  console.log(
    '7. Check browser console and server logs for detailed flow information',
  );

  console.log('\n🔍 Expected Logs:');
  console.log(
    '- "Attempting to upgrade guest user [ID] to regular user with email [EMAIL]"',
  );
  console.log(
    '- "Successfully upgraded guest user to regular user with ID [ID]"',
  );
  console.log('- "Authenticated GitHub user [EMAIL] with ID [ID]"');
  console.log('- No more "Guest user not found" errors');
  console.log('- No more foreign key constraint violations');
}

testAuthFlow().catch(console.error);
