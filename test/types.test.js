/** Compile the public declaration fixture as part of the test gate. */

const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('Markdown request declarations accept valid and reject invalid calls', () => {
  const result = spawnSync(
    process.execPath,
    ['node_modules/typescript/lib/tsc.js', '-p', 'test/types/tsconfig.json'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
