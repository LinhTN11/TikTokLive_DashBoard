import fs from 'node:fs';
import { Client } from 'pg';

const schemaPath = 'apps/live-overlay/db/schema.sql';
const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tiktok_live_overlay';

const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query(fs.readFileSync(schemaPath, 'utf8'));
  console.log('Live overlay schema applied.');
} finally {
  await client.end();
}
