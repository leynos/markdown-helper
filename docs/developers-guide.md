# Develop and package Markdown Helper

This guide shows how to change Markdown Helper, validate the extension, and
build its unsigned Firefox package.

## Prerequisites

- Node.js 18 or later
- Bun
- `make`
- `zip`
- Firefox for manual extension checks

Install the pinned development tools before running the gates:

```shell
bun install --frozen-lockfile
```

## Follow the extension flow

The extension uses three browser scripts:

1. `src/background.js` registers the parent context menu and six child items.
   A click sends the command, target-element identifier, and frame identifier
   to the originating tab.
2. `src/content.js` resolves that identifier with
   `browser.menus.getTargetElement()`, validates the field, and invokes the
   synchronous `handleMenuClick(element, command)` boundary.
3. `src/markdown.js` calculates immutable text edits and the selection that
   should remain after those edits.

`MDHelper.apply(command, value, start, end)` is the transformation API. It
returns `null` for a no-op or a result with non-overlapping `edits` in original
string coordinates plus the final `selection`. The content script applies
edits from the highest offset to the lowest so earlier ranges stay valid.

The content script attempts `document.execCommand()` first because Firefox can
place that edit on the field's native undo stack. It verifies the resulting
value and falls back to `setRangeText()` if the command fails or changes
nothing. An input-event observer prevents duplicate notifications when the
native path emits `input`; the content script synthesizes one event only when
the completed edit remained silent. See
[ADR-0001](adr/0001-preserve-native-undo.md).

## Change a Markdown command

1. Change the pure transformation in `src/markdown.js`.
2. Add example-based cases to `test/markdown.test.js`.
3. Add an invariant to `test/properties.test.js` when the command has a useful
   round-trip, uniqueness, or fence-sizing property.
4. Update `test/extension.test.js` if message routing, target resolution,
   native editing, fallback editing, or event delivery changes.
5. Update the command description in [the user guide](users-guide.md) when the
   user-visible contract changes.

The wiring tests execute the real browser scripts in `node:vm` with recording
DOM and WebExtension fakes. Native success, silent native success, verified
no-op fallback, and `execCommand()` failure each have a distinct test path.

## Run the commit gates

Run the gates in this order:

```shell
make check-fmt
make lint
make typecheck
make test
```

`make check-fmt` and `make lint` use the Biome version pinned in `bun.lock`.
`make typecheck` checks the browser source as JavaScript through TypeScript;
`src/globals.d.ts` describes the shared `MDHelper` browser global.

## Build and inspect the package

Run:

```shell
make package
```

The target reruns the tests and creates `dist/markdown-helper.xpi`. The archive
contains `manifest.json`, the three browser scripts, the packaged icon sizes,
and `LICENSE`; it excludes the 1024 px source icon.

Load the XPI temporarily through `about:debugging#/runtime/this-firefox` and
exercise each command in both a `<textarea>` and a supported single-line input
before publishing a release.

## See also

- [User guide](users-guide.md)
- [ADR-0001: Preserve native undo](adr/0001-preserve-native-undo.md)
