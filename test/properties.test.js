/*
 * Property-based tests for the invariants encoded in src/markdown.js:
 * quote and emphasis round-trips, code-block fence sizing, and footnote
 * label monotonicity. Cases are produced by a small seeded linear
 * congruential generator so failures reproduce deterministically without
 * an external property-testing dependency. Example-based cases live in
 * markdown.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const MD = require('../src/markdown.js');

const RUNS = 200;

/** Deterministic PRNG (32-bit LCG). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const randInt = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (rand, items) => items[randInt(rand, 0, items.length - 1)];

const WORDS = ['foo', 'bar', 'qux', 'zap', 'x1', 'why not', 'end.'];

/** A line that is either empty or has non-whitespace content. */
function randomLine(rand) {
  if (rand() < 0.2) return '';
  const indent = ' '.repeat(randInt(rand, 0, 3));
  const words = Array.from({ length: randInt(rand, 1, 4) }, () =>
    pick(rand, WORDS),
  );
  return indent + words.join(' ');
}

function randomText(rand, lineFn = randomLine) {
  return Array.from({ length: randInt(rand, 1, 6) }, () => lineFn(rand)).join(
    '\n',
  );
}

function applyAll(value, result) {
  return MD.applyToString(value, result);
}

function seedFootnoteReferences(rand, text) {
  // Seed the document with some existing numeric and named refs.
  for (let j = randInt(rand, 0, 3); j > 0; j -= 1) {
    text += `[^${pick(rand, [1, 2, 7, 'note'])}]`;
  }
  return text;
}

function assertFootnoteLabels(rand, text, caseIndex) {
  let previous = 0;
  for (let round = 0; round < 3; round += 1) {
    const wordAt = text.indexOf(pick(rand, WORDS).split(' ')[0]);
    if (wordAt < 0) return;
    const result = MD.apply('footnote', text, wordAt, wordAt + 2);
    const next = Number(MD.nextFootnoteLabel(text));
    text = applyAll(text, result);
    const labels = [...text.matchAll(/\[\^(\d+)\]:/g)].map((m) => Number(m[1]));
    assert.ok(labels.includes(next), `definition missing (case ${caseIndex})`);
    assert.equal(
      new Set(labels).size,
      labels.length,
      `duplicate labels (case ${caseIndex})`,
    );
    assert.ok(next > previous, `labels not increasing (case ${caseIndex})`);
    previous = next;
  }
}

test('property: quoting then unquoting restores any unquoted text', () => {
  const rand = rng(0xbeef);
  for (let i = 0; i < RUNS; i += 1) {
    // Guarantee at least one non-blank, unquoted line so the first toggle
    // adds a level (generated lines never start with ">").
    const text = `${randomText(rand)}\n${pick(rand, WORDS)}`;
    const r1 = MD.apply('quote', text, 0, text.length);
    const quoted = applyAll(text, r1);
    for (const line of quoted.split('\n')) {
      assert.match(line, /^>/, `line not quoted: ${JSON.stringify(line)}`);
    }
    const r2 = MD.apply('quote', quoted, r1.selection.start, r1.selection.end);
    assert.equal(applyAll(quoted, r2), text, `seed case ${i}`);
  }
});

test('property: bold and italic double-toggle is the identity', () => {
  const rand = rng(0xcafe);
  for (let i = 0; i < RUNS; i += 1) {
    const text = randomText(rand);
    const a = randInt(rand, 0, text.length);
    const b = randInt(rand, 0, text.length);
    const [start, end] = a <= b ? [a, b] : [b, a];
    for (const command of ['bold', 'italic']) {
      const r1 = MD.apply(command, text, start, end);
      const once = applyAll(text, r1);
      const r2 = MD.apply(command, once, r1.selection.start, r1.selection.end);
      assert.equal(applyAll(once, r2), text, `${command} seed case ${i}`);
    }
  }
});

test('property: code block wrap picks a fence longer than any inside', () => {
  const rand = rng(0xf00d);
  const codeLine = (rand) =>
    rand() < 0.3 ? '`'.repeat(randInt(rand, 3, 5)) : randomLine(rand);
  for (let i = 0; i < RUNS; i += 1) {
    // Non-fence first and last lines so the toggle always wraps.
    const text = [
      pick(rand, WORDS),
      randomText(rand, codeLine),
      pick(rand, WORDS),
    ].join('\n');
    const r1 = MD.apply('code-block', text, 0, text.length);
    const wrapped = applyAll(text, r1);
    const lines = wrapped.split('\n');
    const fence = lines[0];
    assert.match(fence, /^`{3,}$/);
    for (const line of lines.slice(1, -1)) {
      const m = line.match(/^ {0,3}(`{3,})/);
      if (m) {
        assert.ok(
          m[1].length < fence.length,
          `embedded fence ${m[1]} not shorter than ${fence} (case ${i})`,
        );
      }
    }
    const r2 = MD.apply(
      'code-block',
      wrapped,
      r1.selection.start,
      r1.selection.end,
    );
    assert.equal(applyAll(wrapped, r2), text, `round-trip seed case ${i}`);
  }
});

test('property: footnote labels increase strictly and never collide', () => {
  const rand = rng(0xd1ce);
  for (let i = 0; i < RUNS; i += 1) {
    const text = seedFootnoteReferences(rand, randomText(rand));
    assertFootnoteLabels(rand, text, i);
  }
});
