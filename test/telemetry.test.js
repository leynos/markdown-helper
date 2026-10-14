/** Metric label bounds, span correlation, and latency aggregation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function loadTelemetry() {
  let time = 0;
  const logs = [];
  const sandbox = {
    module: { exports: {} },
    performance: { now: () => time },
    console: { debug: (...args) => logs.push(args) },
  };
  vm.runInNewContext(fs.readFileSync('src/telemetry.js', 'utf8'), sandbox);
  return {
    telemetry: sandbox.module.exports,
    logs,
    setTime: (next) => {
      time = next;
    },
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('telemetry aggregates fixed labels and closes a correlated span once', () => {
  const { telemetry, logs, setTime } = loadTelemetry();
  const span = telemetry.start('delivery', 'menu-7');
  setTime(25);
  span.end('success');
  span.end('success');
  assert.deepEqual(plain(telemetry.snapshot()), [
    {
      labels: 'delivery:success:none',
      count: 1,
      durationMs: 25,
      buckets: [0, 0, 1, 0, 0],
    },
  ]);
  assert.equal(logs.length, 2);
  assert.equal(logs[0][2].operationId, 'menu-7');
  assert.equal(logs[1][2].operationId, 'menu-7');
  const snapshot = telemetry.snapshot();
  snapshot[0].buckets[0] = 42;
  assert.equal(telemetry.snapshot()[0].buckets[0], 0);
});

test('telemetry rejects arbitrary labels and never stores operation IDs as labels', () => {
  const { telemetry, logs } = loadTelemetry();
  assert.throws(() => telemetry.start('private selected text', 'menu-1'));
  for (let i = 0; i < 1000; i += 1) {
    telemetry.start('edit', `menu-${i}`).end('fallback', 'command-failed');
  }
  assert.equal(telemetry.snapshot().length, 1);
  assert.equal(telemetry.snapshot()[0].count, 1000);
  const span = telemetry.start('apply', 'private selected text');
  assert.throws(() => span.end('private selected text'));
  assert.throws(() => span.end('failure', 'private selected text'));
  span.end('failure', 'apply-failed');
  assert.ok(!JSON.stringify(logs).includes('private selected text'));
  assert.ok(!JSON.stringify(telemetry.snapshot()).includes('menu-'));
});

test('telemetry bounds duration and tolerates a non-monotonic clock', () => {
  const { telemetry, setTime } = loadTelemetry();
  const slow = telemetry.start('apply', 'menu-1');
  setTime(2_000_000_000);
  slow.end('success');
  assert.equal(telemetry.snapshot()[0].durationMs, 1_000_000_000);
  assert.equal(telemetry.snapshot()[0].buckets[4], 1);
  const backwards = telemetry.start('apply', 'menu-2');
  setTime(0);
  backwards.end('noop');
  assert.equal(telemetry.snapshot()[1].durationMs, 0);
  assert.equal(telemetry.snapshot()[1].buckets[0], 1);
});
