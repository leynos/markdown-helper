/** Behavioural tests for the release-version validation script. */

const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

/** Run a command with output isolated from the enclosing test process. */
function run(command, args) {
  const dir = mkdtempSync(join(tmpdir(), 'markdown-helper-check-version-'));
  const output = join(dir, 'output');
  const fd = openSync(output, 'w');
  try {
    const result = spawnSync(command, args, {
      env: { PATH: process.env.PATH },
      stdio: ['ignore', fd, fd],
    });
    return { status: result.status, output: readFileSync(output, 'utf8') };
  } finally {
    closeSync(fd);
    rmSync(dir, { force: true, recursive: true });
  }
}

/** Run the version checker with a controlled argument list. */
function checkVersion(...args) {
  return run('node', ['scripts/check-version.js', ...args]);
}

test('check-version accepts declared versions that agree', () => {
  const result = checkVersion('0.1.0');
  assert.equal(result.status, 0);
  assert.match(result.output, /version 0\.1\.0 agrees/);
});

test('check-version rejects a declared-version mismatch', () => {
  const result = checkVersion('0.1.1');
  assert.equal(result.status, 1);
  assert.match(
    result.output,
    /src\/manifest\.json declares 0\.1\.0, expected 0\.1\.1/,
  );
  assert.match(
    result.output,
    /package\.json declares 0\.1\.0, expected 0\.1\.1/,
  );
});

test('check-version requires an argument', () => {
  const result = checkVersion();
  assert.equal(result.status, 2);
  assert.match(
    result.output,
    /usage: node scripts\/check-version\.js <version>/,
  );
});

test('check-version rejects non-version input', () => {
  const result = checkVersion('0.1.0;echo-INJECTED');
  assert.equal(result.status, 2);
  assert.match(result.output, /major\.minor\.patch decimal notation/);
  assert.doesNotMatch(result.output, /INJECTED/);
});

test('Make passes a hostile version value as data rather than shell code', () => {
  const result = run('make', ['check-version', 'VERSION=0.1.0;echo-INJECTED']);
  assert.equal(result.status, 2);
  assert.match(result.output, /major\.minor\.patch decimal notation/);
  assert.doesNotMatch(result.output, /INJECTED/);
});
