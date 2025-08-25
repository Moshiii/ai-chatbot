#!/usr/bin/env node
/**
 * Database Functions Bootstrap Script
 *
 * This script applies SQL functions and triggers to your database.
 * Run this when you need to bootstrap database functions separately.
 *
 * Usage:
 *   npx tsx lib/db/bootstrap-functions.ts
 *   or
 *   npm run db:bootstrap-functions
 */

import { config } from 'dotenv';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function bootstrapFunctions() {
  const functionsDir = path.join(__dirname, 'functions');

  try {
    // Get database connection
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error('POSTGRES_URL environment variable is required');
    }

    const client = postgres(connectionString);
    const db = drizzle(client);

    console.log('🔄 Starting database functions bootstrap...');

    // Read all SQL files in the functions directory
    const sqlFiles = await fs.readdir(functionsDir);
    const sortedSqlFiles = sqlFiles
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => {
        // Extract numeric prefix for ordering
        const aNum = Number.parseInt(a.split('_')[0]) || 0;
        const bNum = Number.parseInt(b.split('_')[0]) || 0;
        return aNum - bNum;
      });

    console.log(`📁 Found ${sortedSqlFiles.length} SQL files to execute`);

    // Execute each SQL file
    for (const file of sortedSqlFiles) {
      const filePath = path.join(functionsDir, file);
      console.log(`📄 Executing ${file}...`);

      const sqlContent = await fs.readFile(filePath, 'utf-8');

      // Execute the entire SQL file as one statement
      // This handles complex functions with semicolons in the body
      const cleanSql = sqlContent
        .split('\n')
        .filter((line) => !line.trim().startsWith('--') || line.trim() === '')
        .join('\n')
        .trim();

      if (cleanSql) {
        await client.unsafe(cleanSql);
      }

      console.log(`✅ Successfully executed ${file}`);
    }

    console.log('🎉 Database functions bootstrap completed successfully!');

    // Close the connection
    await client.end();
  } catch (error) {
    console.error('❌ Error during bootstrap:', error);
    process.exit(1);
  }
}

// Run the bootstrap if this script is executed directly
if (require.main === module) {
  bootstrapFunctions();
}

export { bootstrapFunctions };
