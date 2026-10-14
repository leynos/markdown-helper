# Migrating to Markdown Helper 0.2

Markdown Helper 0.2 introduces the Firefox extension workflow for applying
Markdown formatting directly in supported text fields. No data migration is
required: the extension stores no settings or document content.

## Install the extension

Install the extension temporarily from a local repository copy:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on…**.
3. Select `src/manifest.json`.

Alternatively, build the unsigned package with `make package`, then load
`dist/markdown-helper.xpi` through the same **Load Temporary Add-on…** control.
Temporary extensions must be loaded again after Firefox restarts.

## Use the new workflow

Select text in a `<textarea>` or supported single-line text, search or URL
input. Right-click the selection, open **Markdown**, and choose a formatting
command. The commands toggle quote, bold, italic, code-span and code-block
markers, or convert the selection to a GFM footnote. The user guide contains
the complete command reference and scope limitations.

Existing workflows that depend on contenteditable rich-text editors are not
supported by this release; use a plain-text field instead.

See the [user guide](users-guide.md) for the complete installation and usage
instructions.
