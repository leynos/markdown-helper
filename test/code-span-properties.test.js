/** Reproducible, shrinking code-span fence and round-trip checks. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const MD = require('../src/markdown.js');

const surroundingText = fc.string({
  unit: fc.constantFrom('a', 'b', ' ', '\n'),
  maxLength: 30,
});
const selectedText = fc
  .tuple(
    fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 2, maxLength: 8 }),
    fc.boolean(),
    fc.boolean(),
  )
  .map(([runs, leftEdge, rightEdge]) => {
    const middle = runs.map((length) => `x${'`'.repeat(length)}`).join('y');
    // Unequal edge runs cannot be mistaken for an existing enclosing fence.
    return `${leftEdge ? '`' : 'a'}${middle}${rightEdge ? '``' : 'z'}`;
  });

test('property: code-span fences, padding, and returned selections round-trip', () => {
  fc.assert(
    fc.property(
      surroundingText,
      selectedText,
      surroundingText,
      (prefix, selected, suffix) => {
        const value = prefix + selected + suffix;
        const start = prefix.length;
        const end = start + selected.length;
        const result = MD.toggleCodeSpan(value, start, end);
        const wrapped = MD.applyToString(value, result);
        const replacement = wrapped.slice(
          start,
          wrapped.length - suffix.length,
        );
        const fenceLength = replacement.match(/^`+/)[0].length;
        for (const run of selected.match(/`+/g)) {
          assert.ok(fenceLength > run.length);
        }
        const pad =
          selected.startsWith('`') || selected.endsWith('`') ? ' ' : '';
        assert.equal(
          replacement.slice(fenceLength, -fenceLength),
          pad + selected + pad,
        );
        assert.deepEqual(result.selection, {
          start,
          end: start + replacement.length,
        });
        const undone = MD.toggleCodeSpan(
          wrapped,
          result.selection.start,
          result.selection.end,
        );
        assert.equal(MD.applyToString(wrapped, undone), value);
        assert.deepEqual(undone.selection, { start, end });
      },
    ),
    { seed: 0xc0de, numRuns: 1000 },
  );
});
