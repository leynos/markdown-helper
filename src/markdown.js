'use strict';

/*
 * Pure text transformations for the Markdown Helper extension.
 *
 * Every operation takes the full field value plus the selection range and
 * returns either null (nothing to do) or:
 *   {
 *     edits: [{ start, end, text }],   // ranges in ORIGINAL coordinates,
 *                                      // non-overlapping
 *     selection: { start, end }        // desired selection in NEW coordinates
 *   }
 *
 * Keeping these pure lets the content script apply them via undo-friendly
 * editor commands and lets the test suite exercise them under Node.
 */

const MDHelper = (() => {
  // ------------------------------------------------------------------
  // Shared helpers
  // ------------------------------------------------------------------

  /**
   * Expand [start, end) to whole-line boundaries. A selection ending just
   * after a newline is treated as ending on the previous line.
   */
  function lineBounds(value, start, end) {
    if (end > start && value[end - 1] === '\n') end -= 1;
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    return { lineStart, lineEnd };
  }

  /** Shrink a selection so it excludes leading/trailing whitespace. */
  function trimSelection(value, start, end) {
    while (start < end && /\s/.test(value[start])) start += 1;
    while (end > start && /\s/.test(value[end - 1])) end -= 1;
    return { start, end };
  }

  function singleEdit(start, end, text, selStart, selEnd) {
    return {
      edits: [{ start, end, text }],
      selection: { start: selStart, end: selEnd },
    };
  }

  // ------------------------------------------------------------------
  // Inline span toggles (bold / italic / code span)
  // ------------------------------------------------------------------

  /**
   * Toggle a wrapping marker pair around the selection.
   *
   * detect: array of { open, close, guard?, keepOpen?, keepClose? } marker
   * pairs recognised for removal; guard(value, openStart, openEnd,
   * closeStart, closeEnd) may veto a match given the marker spans (used so
   * italic "*" does not strip half of a bold "**"). keepOpen/keepClose are
   * what replaces the removed markers (default: nothing) — this lets italic
   * reduce combined "***text***" emphasis back to "**text**".
   * add: { open, close } used when wrapping.
   */
  function toggleWrap(value, start, end, detect, add) {
    ({ start, end } = trimSelection(value, start, end));
    const sel = value.slice(start, end);

    for (const { open, close, guard, keepOpen = '', keepClose = '' } of detect) {
      // Markers included in the selection itself: **text**
      if (
        sel.length >= open.length + close.length &&
        sel.startsWith(open) &&
        sel.endsWith(close) &&
        (!guard ||
          guard(value, start, start + open.length, end - close.length, end))
      ) {
        const inner = sel.slice(open.length, sel.length - close.length);
        const text = keepOpen + inner + keepClose;
        return singleEdit(start, end, text, start, start + text.length);
      }
      // Markers immediately surrounding the selection: **|text|**
      if (
        start - open.length >= 0 &&
        value.startsWith(open, start - open.length) &&
        value.startsWith(close, end) &&
        (!guard ||
          guard(value, start - open.length, start, end, end + close.length))
      ) {
        const text = keepOpen + sel + keepClose;
        return singleEdit(
          start - open.length,
          end + close.length,
          text,
          start - open.length,
          start - open.length + text.length
        );
      }
    }

    const text = add.open + sel + add.close;
    return singleEdit(
      start,
      end,
      text,
      start + add.open.length,
      start + add.open.length + sel.length
    );
  }

  function toggleBold(value, start, end) {
    return toggleWrap(
      value,
      start,
      end,
      [
        { open: '**', close: '**' },
        { open: '__', close: '__' },
      ],
      { open: '**', close: '**' }
    );
  }

  function toggleItalic(value, start, end) {
    // A lone "*" only counts as italic when neither marker abuts another
    // "*" (which would make it part of a "**" bold run).
    const notBold =
      (marker) => (value, openStart, openEnd, closeStart, closeEnd) =>
        value[openStart - 1] !== marker &&
        value[openEnd] !== marker &&
        value[closeStart - 1] !== marker &&
        value[closeEnd] !== marker;
    return toggleWrap(
      value,
      start,
      end,
      [
        // Combined bold+italic: removing italic keeps the bold layer.
        {
          open: '***',
          close: '***',
          guard: notBold('*'),
          keepOpen: '**',
          keepClose: '**',
        },
        {
          open: '___',
          close: '___',
          guard: notBold('_'),
          keepOpen: '__',
          keepClose: '__',
        },
        { open: '*', close: '*', guard: notBold('*') },
        { open: '_', close: '_', guard: notBold('_') },
      ],
      { open: '*', close: '*' }
    );
  }

  function backtickRunAt(value, index, direction) {
    let run = 0;
    let i = index;
    while (i >= 0 && i < value.length && value[i] === '`') {
      run += 1;
      i += direction;
    }
    return run;
  }

  function toggleCodeSpan(value, start, end) {
    ({ start, end } = trimSelection(value, start, end));
    const sel = value.slice(start, end);

    // Selection includes its own backtick fence: `text` or `` te`xt ``
    const m = sel.match(/^(`+)( ?)([\s\S]*?)\2\1$/);
    if (m && !m[3].startsWith('`') && !m[3].endsWith('`')) {
      return singleEdit(start, end, m[3], start, start + m[3].length);
    }

    // Fence immediately surrounds the selection.
    const before = backtickRunAt(value, start - 1, -1);
    const after = backtickRunAt(value, end, 1);
    if (before > 0 && before === after && !sel.includes('`')) {
      return singleEdit(
        start - before,
        end + after,
        sel,
        start - before,
        start - before + sel.length
      );
    }

    // Wrap: fence must be longer than any backtick run inside, and content
    // touching a backtick needs space padding (GFM code-span rules).
    let longest = 0;
    for (const run of sel.match(/`+/g) || []) {
      longest = Math.max(longest, run.length);
    }
    const fence = '`'.repeat(longest + 1);
    const pad = sel.startsWith('`') || sel.endsWith('`') ? ' ' : '';
    const text = fence + pad + sel + pad + fence;
    return singleEdit(start, end, text, start, start + text.length);
  }

  // ------------------------------------------------------------------
  // Block quote toggle
  // ------------------------------------------------------------------

  function toggleQuote(value, start, end) {
    const { lineStart, lineEnd } = lineBounds(value, start, end);
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');

    const nonBlank = lines.filter((l) => l.trim() !== '');
    const allQuoted =
      nonBlank.length > 0 && nonBlank.every((l) => /^ {0,3}>/.test(l));

    let newLines;
    if (allQuoted) {
      // Remove exactly one quote level.
      newLines = lines.map((l) =>
        l.trim() === '' ? l : l.replace(/^ {0,3}> ?/, '')
      );
    } else {
      // Add one quote level; blank lines become a bare ">" so the quoted
      // block stays a single block quote.
      newLines = lines.map((l) => (l.trim() === '' ? '>' : '> ' + l));
    }

    const text = newLines.join('\n');
    return singleEdit(lineStart, lineEnd, text, lineStart, lineStart + text.length);
  }

  // ------------------------------------------------------------------
  // Fenced code block toggle
  // ------------------------------------------------------------------

  /** Parse a fence line into { char, length, info }, or null. */
  function parseFence(line) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) return null;
    return { char: m[1][0], length: m[1].length, info: m[2].trim() };
  }

  /**
   * A closing fence must use the same character as the opening fence, be at
   * least as long, and carry no info string (CommonMark fence rules).
   */
  function fencesMatch(open, close) {
    return (
      open !== null &&
      close !== null &&
      close.char === open.char &&
      close.length >= open.length &&
      close.info === ''
    );
  }

  /**
   * Build a backtick fence longer than any backtick fence line inside the
   * block, so embedded Markdown examples cannot terminate it early.
   */
  function fenceFor(lines) {
    let longest = 2;
    for (const line of lines) {
      const m = line.match(/^ {0,3}(`{3,})/);
      if (m) longest = Math.max(longest, m[1].length);
    }
    return '`'.repeat(longest + 1);
  }

  function toggleCodeBlock(value, start, end) {
    const { lineStart, lineEnd } = lineBounds(value, start, end);
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');

    // Selection includes the fences themselves.
    if (
      lines.length >= 2 &&
      fencesMatch(parseFence(lines[0]), parseFence(lines[lines.length - 1]))
    ) {
      const inner = lines.slice(1, -1).join('\n');
      return singleEdit(lineStart, lineEnd, inner, lineStart, lineStart + inner.length);
    }

    // Fence lines immediately above and below the selection.
    if (lineStart > 0 && lineEnd < value.length) {
      const prevBounds = lineBounds(value, lineStart - 1, lineStart - 1);
      const nextBounds = lineBounds(value, lineEnd + 1, lineEnd + 1);
      const prevLine = value.slice(prevBounds.lineStart, prevBounds.lineEnd);
      const nextLine = value.slice(nextBounds.lineStart, nextBounds.lineEnd);
      if (fencesMatch(parseFence(prevLine), parseFence(nextLine))) {
        // Remove both fence lines (each with its trailing/leading newline).
        return {
          edits: [
            { start: prevBounds.lineStart, end: lineStart, text: '' },
            { start: lineEnd, end: nextBounds.lineEnd, text: '' },
          ],
          selection: {
            start: prevBounds.lineStart,
            end: prevBounds.lineStart + block.length,
          },
        };
      }
    }

    const fence = fenceFor(lines);
    const text = fence + '\n' + block + '\n' + fence;
    return singleEdit(lineStart, lineEnd, text, lineStart, lineStart + text.length);
  }

  // ------------------------------------------------------------------
  // GFM footnote
  // ------------------------------------------------------------------

  function nextFootnoteLabel(value) {
    let next = 1;
    const re = /\[\^([^\]\s]+)\]/g;
    let m;
    while ((m = re.exec(value)) !== null) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= next) next = n + 1;
    }
    return String(next);
  }

  function makeFootnote(value, start, end) {
    ({ start, end } = trimSelection(value, start, end));
    if (start === end) return null;
    const sel = value.slice(start, end);

    const label = nextFootnoteLabel(value);
    const ref = `[^${label}]`;

    // Continuation lines of a footnote definition are indented four spaces.
    const defBody = sel
      .split('\n')
      .map((line, i) => {
        if (i === 0) return line;
        if (line.trim() === '') return '';
        return '    ' + line;
      })
      .join('\n');
    const definition = `[^${label}]: ${defBody}`;

    // Append after existing content; if the text already ends with a
    // footnote definition (or its continuation), keep definitions adjacent.
    const trimmedLen = value.replace(/\s+$/, '').length;
    const lastLine = value.slice(0, trimmedLen).split('\n').pop() || '';
    const isDefTail = /^(\[\^[^\]\s]+\]:|    \S)/.test(lastLine);
    const sep = trimmedLen === 0 ? '' : isDefTail ? '\n' : '\n\n';

    return {
      edits: [
        { start, end, text: ref },
        { start: trimmedLen, end: value.length, text: sep + definition + '\n' },
      ],
      selection: { start: start + ref.length, end: start + ref.length },
    };
  }

  // ------------------------------------------------------------------
  // Dispatch
  // ------------------------------------------------------------------

  const commands = {
    quote: toggleQuote,
    bold: toggleBold,
    italic: toggleItalic,
    'code-span': toggleCodeSpan,
    'code-block': toggleCodeBlock,
    footnote: makeFootnote,
  };

  function apply(command, value, start, end) {
    const fn = commands[command];
    if (!fn) throw new Error(`Unknown command: ${command}`);
    return fn(value, start, end);
  }

  /** Apply a result to a plain string (used by tests). */
  function applyToString(value, result) {
    if (!result) return value;
    const edits = [...result.edits].sort((a, b) => b.start - a.start);
    let out = value;
    for (const { start, end, text } of edits) {
      out = out.slice(0, start) + text + out.slice(end);
    }
    return out;
  }

  return {
    apply,
    applyToString,
    toggleQuote,
    toggleBold,
    toggleItalic,
    toggleCodeSpan,
    toggleCodeBlock,
    makeFootnote,
    nextFootnoteLabel,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MDHelper;
}
