import fs from 'node:fs';

const checks = [
  {
    file: 'apps/live-overlay/db/schema.sql',
    mustInclude: [
      'primary key (channel_id, viewer_id)',
      'unique (channel_id, viewer_id, theme_slug, scope_key)',
      "check (unlock_mode in ('lifetime', 'session'))",
    ],
  },
  {
    file: 'apps/live-overlay/server.ts',
    mustInclude: [
      "socket.on('live:start'",
      "socket.on('live:stop'",
      "socket.on('test:gift'",
      "socket.on('test:chat'",
      "socket.on('test:follow'",
      "socket.on('settings:update'",
      "socket.on('session:reset'",
    ],
  },
  {
    file: 'apps/live-overlay/src/features/themes/registry.tsx',
    mustInclude: ["slug: 'vip'", "slug: 'donator'", 'export const chatThemes'],
  },
  {
    file: 'apps/live-overlay/src/server/live-manager.ts',
    mustInclude: [
      "this.io.emit('event:chat'",
      "this.io.emit('event:gift'",
      "this.io.emit('event:follow'",
      "this.io.emit('theme:unlocked'",
    ],
  },
];

const failures = [];

for (const check of checks) {
  const source = fs.readFileSync(check.file, 'utf8');
  for (const expected of check.mustInclude) {
    if (!source.includes(expected)) {
      failures.push(`${check.file} is missing ${expected}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Live overlay domain contract check passed.');
