#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { createTestLink, TEST_PLAN_NAME, validateTestPlan } from '../dist/diagnostics/testFeedback.js';

const [url, path] = process.argv.slice(2);
if (!url || !path) {
  console.error('Usage: node scripts/create-test-link.mjs <app-url> <plan.json>\n'
    + 'A plan saved as <app repo>/build/test-plans/<name>.json gets a short link, <app-url>test/<name>, which the app\'s dev server opens.\n'
    + 'Any other plan path gets a self-contained link for a build without that server.\n'
    + 'Run npm run build in ui first.');
  process.exitCode = 1;
} else {
  const plan = validateTestPlan(JSON.parse(await readFile(path, 'utf8')));
  const name = basename(path, '.json');
  if (basename(dirname(path)) !== 'test-plans') console.log(createTestLink(url, plan));
  else if (!TEST_PLAN_NAME.test(name)) {
    console.error(`Name the plan file with letters, digits, - and _ only: ${basename(path)}`);
    process.exitCode = 1;
  } else {
    const page = new URL(url);
    if (!['http:', 'https:'].includes(page.protocol) || page.hash) throw new Error('Use an HTTP or HTTPS page address without a fragment');
    const directory = page.pathname.endsWith('/') ? page.pathname : `${page.pathname.slice(0, page.pathname.lastIndexOf('/') + 1)}`;
    console.log(`${page.origin}${directory}test/${name}${page.search}`);
  }
}
