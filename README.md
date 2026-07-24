# Markdown Helper

A Firefox extension that adds a **Markdown** context menu to text boxes.
Select some text in a `<textarea>` (or single-line text input), right-click,
and apply Markdown formatting.

## Commands

| Command | Behaviour |
| --- | --- |
| Toggle Quote | Prefixes each selected line with `> ` (blank lines become `>`). If every selected line is already quoted, removes one quote level instead. Nesting is handled cleanly: quoting a region that already contains a quote produces a properly nested block quote. |
| Toggle Bold | Wraps the selection in `**…**`; removes existing `**…**` or `__…__` markers, whether they are inside or immediately around the selection. |
| Toggle Italic | Wraps in `*…*`; removes existing `*…*` or `_…_`. Will not strip half of a `**bold**` run — italicising bold text yields `***bold italic***`. |
| Toggle Code Span | Wraps in backticks, using a longer fence (and space padding) when the selection itself contains backticks, per GFM code-span rules. Removes an existing span. |
| Toggle Code Block | Expands the selection to whole lines and wraps it in ``` fences on their own lines. Removes fences when they are inside the selection or on the lines immediately above and below it. |
| Convert to Footnote | Replaces the selection with a `[^n]` reference and appends `[^n]: …` at the end of the text box. `n` is chosen with awareness of existing footnote references and definitions (next number after the highest numeric label in use). Multi-line selections are indented as footnote continuation lines. Not a toggle. |

All commands except the footnote are toggles: applying one to already
formatted text removes the formatting.

### Quote nesting example

Selecting all of:

```
foo

> bar

qux
```

and applying Toggle Quote produces:

```
> foo
>
> > bar
>
> qux
```

Applying it again restores the original text.

## Development

```sh
make test      # run the unit tests (Node >= 18)
make package   # build dist/markdown-helper.xpi
```

To try it out without packaging, open `about:debugging#/runtime/this-firefox`
in Firefox, choose *Load Temporary Add-on…*, and pick `src/manifest.json`.

## Layout

- `src/manifest.json` — extension manifest (Manifest V2, Firefox)
- `src/background.js` — creates the context menu, relays clicks to the page
- `src/content.js` — locates the right-clicked field and applies edits
  (via `execCommand("insertText")` so changes stay on the undo stack)
- `src/markdown.js` — pure text transformations, shared with the tests
- `test/markdown.test.js` — unit tests (`node --test`)
