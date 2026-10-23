#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createTestLink } from '../dist/diagnostics/testFeedback.js';

const [url, path] = process.argv.slice(2);
if (!url || !path) {
  console.error('Usage: node scripts/create-test-link.mjs <app-url> <plan.json>\nRun npm run build in ui first.');
  process.exitCode = 1;
} else {
  console.log(createTestLink(url, JSON.parse(await readFile(path, 'utf8'))));
}
