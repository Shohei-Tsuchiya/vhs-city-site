#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'status.json');
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

if (!existsSync(STATUS_PATH)) {
  writeFileSync(
    STATUS_PATH,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), live: [], upcoming: [] }, null, 2)}\n`,
    'utf8'
  );
  console.log('Created empty status.json');
  process.exit(0);
}

const status = JSON.parse(readFileSync(STATUS_PATH, 'utf8'));
const ageMs = Date.now() - new Date(status.updatedAt || 0).getTime();

if (Number.isNaN(ageMs) || ageMs > MAX_AGE_MS) {
  const empty = { updatedAt: new Date().toISOString(), live: [], upcoming: [] };
  writeFileSync(STATUS_PATH, `${JSON.stringify(empty, null, 2)}\n`, 'utf8');
  console.log(`Discarded stale status.json (age: ${Math.round(ageMs / 60000)} min)`);
} else {
  console.log(`Keeping status.json (age: ${Math.round(ageMs / 60000)} min)`);
}
