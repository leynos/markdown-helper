/*
 * Example-based unit tests for the pure text transformations in
 * src/markdown.js. Each case marks the selection with «…» delimiters and
 * asserts the resulting text. Property-based invariants live in
 * properties.test.js; the browser wiring is covered by extension.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const MD = require('../src/markdown.js');

/** Run a command against a value marked up with «selection» delimiters. */
function run(command, marked) {
  const start = marked.indexOf('«');
  const end = marked.indexOf('»') - 1;
  assert.ok(start >= 0 && end >= start, 'test input needs «…» markers');
  const value = marked.replace('«', '').replace('»', '');
  const result = MD.apply({ command, value, start, end });
  return MD.applyToString(value, result);
}

// ---------------------------------------------------------------- quote

test('quote adds one level to plain text', () => {
  assert.equal(run('quote', '«foo»'), '> foo');
});

test('quote nests cleanly across blank lines and existing quotes', () => {
  const input = '«foo\n\n> bar\n\nqux»';
  assert.equal(run('quote', input), '> foo\n>\n> > bar\n>\n> qux');
});

test('quote removes one level when every line is quoted', () => {
  const input = '«> foo\n>\n> > bar\n>\n> qux»';
  assert.equal(run('quote', input), 'foo\n\n> bar\n\nqux');
});

test('quote round-trips', () => {
  const original = 'foo\n\n> bar\n\nqux';
  const quoted = run('quote', `«${original}»`);
  assert.equal(run('quote', `«${quoted}»`), original);
});

test('quote expands a partial selection to whole lines', () => {
  assert.equal(run('quote', 'aaa\nb«b»b\nccc'), 'aaa\n> bbb\nccc');
});

test('quote only affects selected lines', () => {
  assert.equal(run('quote', 'aaa\n«bbb»\nccc'), 'aaa\n> bbb\nccc');
});

// ----------------------------------------------------------------- bold

test('bold wraps a selection', () => {
  assert.equal(run('bold', 'say «hello» there'), 'say **hello** there');
});

test('bold unwraps when markers are inside the selection', () => {
  assert.equal(run('bold', 'say «**hello**» there'), 'say hello there');
});

test('bold unwraps when markers surround the selection', () => {
  assert.equal(run('bold', 'say **«hello»** there'), 'say hello there');
});

test('bold recognises __ markers for removal', () => {
  assert.equal(run('bold', 'say «__hello__» there'), 'say hello there');
});

test('bold trims whitespace from the selection edges', () => {
  assert.equal(run('bold', 'say« hello »there'), 'say **hello** there');
});

// --------------------------------------------------------------- italic

test('italic wraps a selection', () => {
  assert.equal(run('italic', 'say «hello» there'), 'say *hello* there');
});

test('italic unwraps *…* and _…_', () => {
  assert.equal(run('italic', 'say «*hello*» there'), 'say hello there');
  assert.equal(run('italic', 'say _«hello»_ there'), 'say hello there');
});

test('italic on bold text adds italic instead of breaking bold', () => {
  assert.equal(run('italic', 'say «**hello**» there'), 'say ***hello*** there');
  assert.equal(run('italic', 'say **«hello»** there'), 'say ***hello*** there');
});

test('italic on combined emphasis removes only the italic layer', () => {
  assert.equal(run('italic', 'say «***hello***» there'), 'say **hello** there');
  assert.equal(run('italic', 'say ***«hello»*** there'), 'say **hello** there');
  assert.equal(run('italic', 'say «___hello___» there'), 'say __hello__ there');
});

test('empty-selection emphasis markers toggle back off', () => {
  const r1 = MD.apply({ command: 'italic', value: 'ab', start: 1, end: 1 });
  const once = MD.applyToString('ab', r1);
  assert.equal(once, 'a**b');
  const r2 = MD.apply({
    command: 'italic',
    value: once,
    start: r1.selection.start,
    end: r1.selection.end,
  });
  assert.equal(MD.applyToString(once, r2), 'ab');
});

test('italic toggle round-trips over bold text', () => {
  const once = run('italic', 'say **«hello»** there');
  assert.equal(once, 'say ***hello*** there');
  assert.equal(run('italic', 'say «***hello***» there'), 'say **hello** there');
});

// ------------------------------------------------------------ code span

test('code span wraps a selection', () => {
  assert.equal(run('code-span', 'run «ls -la» now'), 'run `ls -la` now');
});

test('code span unwraps inner and surrounding backticks', () => {
  assert.equal(run('code-span', 'run «`ls`» now'), 'run ls now');
  assert.equal(run('code-span', 'run `«ls»` now'), 'run ls now');
});

test('code span handles content containing backticks', () => {
  assert.equal(run('code-span', 'use «a`b» here'), 'use ``a`b`` here');
  assert.equal(run('code-span', 'use «``a`b``» here'), 'use a`b here');
});

test('code span pads content that starts with a backtick', () => {
  assert.equal(run('code-span', 'tick «`x» end'), 'tick `` `x `` end');
});

test('code span handles an adversarial unmatched backtick run', () => {
  const value = `${'`'.repeat(10_000)}x`;
  const result = MD.apply({
    command: 'code-span',
    value,
    start: 0,
    end: value.length,
  });
  assert.equal(result.edits[0].text.length, 30_005);
});

// ----------------------------------------------------------- code block

test('code block wraps selected lines', () => {
  assert.equal(
    run('code-block', 'a\n«x = 1\ny = 2»\nb'),
    'a\n```\nx = 1\ny = 2\n```\nb',
  );
});

test('code block unwraps when fences are inside the selection', () => {
  assert.equal(run('code-block', 'a\n«```\nx = 1\n```»\nb'), 'a\nx = 1\nb');
});

test('code block unwraps when fences surround the selection', () => {
  assert.equal(run('code-block', 'a\n```\n«x = 1»\n```\nb'), 'a\nx = 1\nb');
});

test('code block recognises fences with an info string', () => {
  assert.equal(run('code-block', '«```python\nx = 1\n```»'), 'x = 1');
});

test('code block uses a longer fence around embedded backtick fences', () => {
  assert.equal(
    run('code-block', '«# Example\n```\nx = 1\n```»'),
    '````\n# Example\n```\nx = 1\n```\n````',
  );
});

test('code block does not unwrap mismatched fences', () => {
  // A tilde line cannot close a backtick fence, so this is not a fenced
  // block: wrap it (with a fence longer than the embedded backtick run).
  assert.equal(run('code-block', '«```\nx\n~~~»'), '````\n```\nx\n~~~\n````');
  // Nor can a shorter closing fence close a longer opening fence.
  assert.equal(
    run('code-block', '«````\nx\n```»'),
    '`````\n````\nx\n```\n`````',
  );
});

test('code block unwraps longer and tilde fences', () => {
  assert.equal(run('code-block', '«````\nx\n````»'), 'x');
  assert.equal(run('code-block', '«~~~\nx\n~~~»'), 'x');
});

// ------------------------------------------------------------- footnote

test('footnote moves the selection to a definition at the end', () => {
  assert.equal(
    run('footnote', 'This is «important» text.'),
    'This is [^1] text.\n\n[^1]: important\n',
  );
});

test('footnote numbering skips existing labels', () => {
  assert.equal(
    run('footnote', 'Already noted[^2] and «this too».\n\n[^2]: earlier\n'),
    'Already noted[^2] and [^3].\n\n[^2]: earlier\n[^3]: this too\n',
  );
});

test('footnote ignores non-numeric labels but never collides', () => {
  assert.equal(
    run('footnote', 'See[^note] and «this».\n\n[^note]: aside\n'),
    'See[^note] and [^1].\n\n[^note]: aside\n[^1]: this\n',
  );
});

test('footnote labels increment exactly beyond Number.MAX_SAFE_INTEGER', () => {
  const value = 'Already noted[^9007199254740992] and this too.';
  const start = value.indexOf('this');
  const result = MD.apply({
    command: 'footnote',
    value,
    start,
    end: start + 'this too'.length,
  });
  assert.equal(
    MD.applyToString(value, result),
    'Already noted[^9007199254740992] and [^9007199254740993].\n\n[^9007199254740993]: this too\n',
  );
});

test('footnote indents continuation lines', () => {
  assert.equal(
    run('footnote', 'Take «line one\nline two» away.'),
    'Take [^1] away.\n\n[^1]: line one\n    line two\n',
  );
});

test('footnote with whitespace-only selection is a no-op', () => {
  const value = 'a   b';
  const result = MD.apply({ command: 'footnote', value, start: 1, end: 4 });
  assert.equal(MD.applyToString(value, result ?? { edits: [] }), value);
  assert.equal(result, null);
});

// ---------------------------------------------------------------- misc

test('unknown command throws', () => {
  assert.throws(() =>
    MD.apply({ command: 'nope', value: 'x', start: 0, end: 1 }),
  );
});
