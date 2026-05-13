import fs from 'node:fs';
import path from 'node:path';

const schemaPath = path.resolve('apps/live-overlay/db/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
const requiredTables = [
  'channels',
  'viewers',
  'channel_viewer_stats',
  'theme_unlocks',
  'manual_theme_grants',
  'theme_rules',
  'live_sessions',
];

const missing = requiredTables.filter((table) => !new RegExp(`create table if not exists ${table}\\b`, 'i').test(schema));

if (missing.length > 0) {
  console.error(`Missing required tables in ${schemaPath}: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Live overlay migration schema check passed.');
