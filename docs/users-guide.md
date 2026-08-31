# Use Markdown Helper in Firefox

Markdown Helper formats selected text in ordinary Firefox text boxes. Use it
when a site accepts Markdown but provides no formatting toolbar.

## Install the extension temporarily

Firefox and a local copy of this repository are required.

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on…**.
3. Select `src/manifest.json` from the repository.
4. Confirm that **Markdown Helper** appears under **Temporary Extensions**.

Firefox removes temporary extensions when it exits. Repeat these steps after
restarting the browser.

To install the packaged build instead, run `make package` and select
`dist/markdown-helper.xpi` from **Load Temporary Add-on…**. The package is
unsigned and cannot be installed as a permanent release.

## Format selected text

1. Select text in a `<textarea>` or a single-line text, search, or URL input.
2. Right-click the selection.
3. Choose **Markdown**, then choose a command.

| Command | Result |
| --- | --- |
| **Toggle Quote** | Adds or removes one `>` level across whole lines. |
| **Toggle Bold** | Adds or removes `**…**` or `__…__`. |
| **Toggle Italic** | Toggles italic without breaking bold markers. |
| **Toggle Code Span** | Toggles a GFM backtick fence sized to the text. |
| **Toggle Code Block** | Adds or removes a fenced block around whole lines. |
| **Convert to Footnote** | Inserts `[^n]` and appends its definition. |

The first five commands are toggles. Apply the same command again to remove
the formatting. **Convert to Footnote** is not a toggle; it chooses a numeric
label above every footnote reference or definition already in the field.

Each command preserves the resulting selection. Firefox's standard undo
command restores native edits.

## Understand the scope

Markdown Helper works in plain-text `<textarea>` elements and single-line
inputs whose type is `text`, `search`, or `url`, including fields inside
frames. It does not edit `contenteditable` rich-text editors, password fields,
or page content that is not an editable field.

If the **Markdown** menu does not appear, confirm that the pointer is over a
supported editable field. If a temporary installation disappeared, reload
`src/manifest.json` from `about:debugging`.

## See also

- [Developer guide](developers-guide.md)
- [Migration guide for 0.2](migration-0.2.md)
- [Undo-preserving edit boundary](adr/0001-preserve-native-undo.md)
