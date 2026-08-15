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

  /** Build a single replacement and its resulting selection. */
  function singleEdit(start, end, text, selection) {
    return {
      edits: [{ start, end, text }],
      selection,
    };
  }

  // ------------------------------------------------------------------
  // Inline span toggles (bold / italic / code span)
  // ------------------------------------------------------------------

  /** Return whether a selection includes a complete marker pair. */
  function hasIncludedMarkers(value, start, end, marker) {
    const { open, close, guard } = marker;
    const selection = value.slice(start, end);
    if (selection.length < open.length + close.length) return false;
    if (!selection.startsWith(open)) return false;
    if (!selection.endsWith(close)) return false;
    if (!guard) return true;
    return guard(value, start, start + open.length, end - close.length, end);
  }

  /** Return whether a marker pair immediately surrounds a selection. */
  function hasSurroundingMarkers(value, start, end, marker) {
    const { open, close, guard } = marker;
    const openStart = start - open.length;
    if (openStart < 0) return false;
    if (!value.startsWith(open, openStart)) return false;
    if (!value.startsWith(close, end)) return false;
    if (!guard) return true;
    return guard(value, openStart, start, end, end + close.length);
  }

  /**
   * Toggle a wrapping marker pair around the selection.
   *
   * options.detect: array of { open, close, guard?, keepOpen?, keepClose? }
   * marker pairs recognised for removal; guard(value, openStart, openEnd,
   * closeStart, closeEnd) may veto a match given the marker spans (used so
   * italic "*" does not strip half of a bold "**"). keepOpen/keepClose are
   * what replaces the removed markers (default: nothing) — this lets italic
   * reduce combined "***text***" emphasis back to "**text**".
   * options.add: { open, close } used when wrapping.
   */
  function toggleWrap(value, start, end, options) {
    const { detect, add } = options;
    ({ start, end } = trimSelection(value, start, end));
    const sel = value.slice(start, end);

    for (const {
      open,
      close,
      guard,
      keepOpen = '',
      keepClose = '',
    } of detect) {
      // Markers included in the selection itself: **text**
      if (hasIncludedMarkers(value, start, end, { open, close, guard })) {
        const inner = sel.slice(open.length, sel.length - close.length);
        const text = keepOpen + inner + keepClose;
        return singleEdit(start, end, text, {
          start,
          end: start + text.length,
        });
      }
      // Markers immediately surrounding the selection: **|text|**
      if (hasSurroundingMarkers(value, start, end, { open, close, guard })) {
        const text = keepOpen + sel + keepClose;
        return singleEdit(start - open.length, end + close.length, text, {
          start: start - open.length,
          end: start - open.length + text.length,
        });
      }
    }

    const text = add.open + sel + add.close;
    return singleEdit(start, end, text, {
      start: start + add.open.length,
      end: start + add.open.length + sel.length,
    });
  }

  /** Toggle bold markers around the selected non-whitespace text. */
  function toggleBold(value, start, end) {
    return toggleWrap(value, start, end, {
      detect: [
        { open: '**', close: '**' },
        { open: '__', close: '__' },
      ],
      add: { open: '**', close: '**' },
    });
  }

  /** Toggle italic markers without stripping one half of bold markers. */
  function toggleItalic(value, start, end) {
    // A lone "*" only counts as italic when neither marker abuts another
    // "*" (which would make it part of a "**" bold run). When the wrapped
    // text is empty the markers abut each other, so only the outer sides
    // are checked.
    const notBold =
      (marker) => (value, openStart, openEnd, closeStart, closeEnd) =>
        value[openStart - 1] !== marker &&
        value[closeEnd] !== marker &&
        (openEnd === closeStart ||
          (value[openEnd] !== marker && value[closeStart - 1] !== marker));
    return toggleWrap(value, start, end, {
      detect: [
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
      add: { open: '*', close: '*' },
    });
  }

  /** Measure the backtick run adjacent to an index in one direction. */
  function backtickRunAt(value, index, direction) {
    let run = 0;
    let i = index;
    while (value[i] === '`') {
      run += 1;
      i += direction;
    }
    return run;
  }

  /** Toggle a GFM code span, choosing a fence longer than its contents. */
  function toggleCodeSpan(value, start, end) {
    ({ start, end } = trimSelection(value, start, end));
    const sel = value.slice(start, end);

    // Selection includes its own backtick fence: `text` or `` te`xt ``
    const m = sel.match(/^(`+)( ?)([\s\S]*?)\2\1$/);
    if (m && !m[3].startsWith('`') && !m[3].endsWith('`')) {
      return singleEdit(start, end, m[3], {
        start,
        end: start + m[3].length,
      });
    }

    // Fence immediately surrounds the selection.
    const before = backtickRunAt(value, start - 1, -1);
    const after = backtickRunAt(value, end, 1);
    if (before > 0 && before === after && !sel.includes('`')) {
      return singleEdit(start - before, end + after, sel, {
        start: start - before,
        end: start - before + sel.length,
      });
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
    return singleEdit(start, end, text, {
      start,
      end: start + text.length,
    });
  }

  // ------------------------------------------------------------------
  // Block quote toggle
  // ------------------------------------------------------------------

  /** Toggle one block-quote level across every selected line. */
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
        l.trim() === '' ? l : l.replace(/^ {0,3}> ?/, ''),
      );
    } else {
      // Add one quote level; blank lines become a bare ">" so the quoted
      // block stays a single block quote.
      newLines = lines.map((l) => (l.trim() === '' ? '>' : `> ${l}`));
    }

    const text = newLines.join('\n');
    return singleEdit(lineStart, lineEnd, text, {
      start: lineStart,
      end: lineStart + text.length,
    });
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

  /** Toggle a fenced code block around the selected whole lines. */
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
      return singleEdit(lineStart, lineEnd, inner, {
        start: lineStart,
        end: lineStart + inner.length,
      });
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
    const text = `${fence}\n${block}\n${fence}`;
    return singleEdit(lineStart, lineEnd, text, {
      start: lineStart,
      end: lineStart + text.length,
    });
  }

  // ------------------------------------------------------------------
  // GFM footnote
  // ------------------------------------------------------------------

  /** Return the first numeric footnote label above every existing label. */
  function nextFootnoteLabel(value) {
    let next = 1;
    const re = /\[\^([^\]\s]+)\]/g;
    let m = re.exec(value);
    while (m !== null) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= next) next = n + 1;
      m = re.exec(value);
    }
    return String(next);
  }

  /** Replace selected text with a reference and append its definition. */
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
        return `    ${line}`;
      })
      .join('\n');
    const definition = `[^${label}]: ${defBody}`;

    // Append after existing content; if the text already ends with a
    // footnote definition (or its continuation), keep definitions adjacent.
    const trimmedLen = value.replace(/\s+$/, '').length;
    const lastLine = value.slice(0, trimmedLen).split('\n').pop() || '';
    const isDefTail = /^(\[\^[^\]\s]+\]:| {4}\S)/.test(lastLine);
    const sep = trimmedLen === 0 ? '' : isDefTail ? '\n' : '\n\n';

    return {
      edits: [
        { start, end, text: ref },
        { start: trimmedLen, end: value.length, text: `${sep}${definition}\n` },
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

  /** Apply a named Markdown command to a selection. */
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
