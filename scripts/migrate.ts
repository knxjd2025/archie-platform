/**
 * Database Migration Script
 *
 * Runs all SQL migration files in the migrations/ directory in order.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('neon.tech') || databaseUrl.includes('supabase')
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    // Create migrations tracking table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of applied migrations
    const { rows: appliedMigrations } = await pool.query(
      'SELECT name FROM _migrations ORDER BY name'
    );
    const appliedNames = new Set(appliedMigrations.map(m => m.name));

    // Get all migration files
    const migrationsDir = path.join(process.cwd(), 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found. Creating it...');
      fs.mkdirSync(migrationsDir, { recursive: true });
      console.log('Migrations directory created. Add .sql files to run migrations.');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      console.log('No migration files found in migrations/');
      return;
    }

    console.log(`Found ${migrationFiles.length} migration files`);

    // Run each migration that hasn't been applied
    for (const file of migrationFiles) {
      if (appliedNames.has(file)) {
        console.log(`  [SKIP] ${file} (already applied)`);
        continue;
      }

      console.log(`  [RUN]  ${file}`);

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      // One checked-out client for the whole transaction. pool.query() takes
      // any free client for each call, so BEGIN, the migration and COMMIT
      // could run on different connections: the migration then ran outside
      // any transaction, a failure half-way left it half-applied, and the
      // ROLLBACK landed on a connection with nothing to roll back.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  [OK]   ${file}`);
      } catch (error: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`  [FAIL] ${file}: ${error.message}`);
        throw error;
      } finally {
        client.release();
      }
    }

    console.log('\nMigrations complete!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
