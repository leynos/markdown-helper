/** Packaging tests for the staged Firefox extension archive. */

const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');

/** Run a command and return its decoded stdout. */
function command(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('assembled XPI contains the runtime extension files only', () => {
  command('make', ['assemble']);
  const entries = command('unzip', ['-Z1', 'dist/markdown-helper.xpi']).split(
    '\n',
  );
  assert.ok(entries.includes('background.js'));
  assert.ok(entries.includes('content.js'));
  assert.ok(entries.includes('markdown.js'));
  assert.ok(entries.includes('manifest.json'));
  assert.ok(entries.includes('icons/icon-128.png'));
  assert.ok(!entries.includes('globals.d.ts'));
  assert.ok(!entries.includes('icons/icon-1024.png'));
});
