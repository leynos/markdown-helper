# 📝 Markdown Helper

*Right-click Markdown formatting for any text box in Firefox.*

<img src="src/icons/icon-128.png" align="right" alt="A chibi scribe writing
an M-down-arrow mark on a parchment scroll" />

Select some text in a `<textarea>`, right-click, and pick a command from the
**Markdown** menu. Quoting, bold, italic, code spans, code blocks, and GFM
footnotes — applied in place, undoable with Ctrl+Z.

______________________________________________________________________

## Why Markdown Helper?

Writing Markdown in a bare web form means typing every marker by hand and
counting `>` characters when quotes start to nest. Markdown Helper does the
fiddly parts for you:

- **Toggles, not stampers**: every formatting command detects existing
  markers — inside or immediately around the selection — and removes them
  instead of piling more on.
- **Quote nesting that behaves**: quoting a region that already contains a
  quote produces one properly nested block quote, and toggling again restores
  the original text exactly.
- **Footnotes with a memory**: converting a selection to a footnote numbers
  it with awareness of every `[^ref]` already in the box.
- **Undo-friendly**: edits go through the browser's native undo stack.

______________________________________________________________________

## Quick start

### Installation

Load it as a temporary add-on while it awaits a signed release:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Choose *Load Temporary Add-on…* and pick `src/manifest.json`.

Or build the package yourself:

```shell
make package   # produces dist/markdown-helper.xpi
```

### Basic usage

Select the following in any multiline text box, right-click, and choose
**Markdown → Toggle Quote**:

```markdown
foo

> bar

qux
```

You get a cleanly nested quote:

```markdown
> foo
>
> > bar
>
> qux
```

Apply the same command again and the original text comes back.

______________________________________________________________________

## Features

- **Toggle Quote** — quotes whole lines (blank lines become `>` so the block
  stays intact); removes one quote level when everything is already quoted.
- **Toggle Bold** — wraps in `**…**`; removes `**…**` or `__…__`.
- **Toggle Italic** — wraps in `*…*`; removes `*…*` or `_…_`, and never
  strips half of a `**bold**` run — italicized bold becomes `***both***`.
- **Toggle Code Span** — wraps in backticks, lengthening the fence and
  padding with spaces when the selection itself contains backticks, per GFM
  code-span rules.
- **Toggle Code Block** — expands the selection to whole lines and wraps it
  in ``` fences; removes fences found inside the selection or on the lines
  directly above and below it.
- **Convert to Footnote** — replaces the selection with `[^n]` and appends
  `[^n]: …` at the end of the text box, choosing `n` as the next number
  after the highest numeric label already referenced or defined. Multiline
  selections are indented as continuation lines. Not a toggle.

Works in `<textarea>` elements and single-line text inputs, in any frame.

______________________________________________________________________

## Development

```shell
make test      # run the unit tests (Node >= 18)
make package   # run the tests, then build dist/markdown-helper.xpi
```

The interesting logic lives in `src/markdown.js` as pure functions shared
between the content script and the test suite:

- `src/manifest.json` — extension manifest (Manifest V2, Firefox)
- `src/background.js` — creates the context menu and relays clicks
- `src/content.js` — locates the right-clicked field and applies edits via
  `execCommand("insertText")`, falling back to `setRangeText`
- `src/markdown.js` — the text transformations
- `test/markdown.test.js` — unit tests (`node --test`)

______________________________________________________________________

## Licence

ISC — see [LICENSE](LICENSE) for details.

______________________________________________________________________

## Contributing

Contributions welcome! Run `make test` before committing — the test suite is
the commit gate, and new behaviour should arrive with a test that proves it.
