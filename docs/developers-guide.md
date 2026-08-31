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

`MDHelper.apply({ command, value, start, end })` is the transformation API. The
request fields are read-only, and `command` is one of `quote`, `bold`, `italic`,
`code-span`, `code-block` or `footnote`. It returns `null` for a no-op or a
result with non-overlapping `edits` in original string coordinates plus the
final `selection`. The content script applies edits from the highest offset to
the lowest so earlier ranges stay valid.

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

## Sign a release

Firefox installs an extension permanently only when Mozilla has signed it. The
project holds no signing key: addons.mozilla.org (AMO) signs the package on its
own infrastructure. What the project does hold is an AMO API key and secret,
used to mint the short-lived JSON Web Tokens that authenticate submissions.

That credential never belongs on a developer workstation. The
[`sign` workflow](../.github/workflows/sign.yml) runs on a `v*` tag, reads the
credential from the protected `release` environment, and signs on a disposable
runner. The environment requires a reviewer's approval and accepts `v*` tags
only, so no push can sign anything unattended.

To cut a release:

1. Raise `version` in both `src/manifest.json` and `package.json`. AMO refuses
   to sign a version it has already seen.
2. Merge the change, then tag the merge commit `vX.Y.Z` and push the tag.
3. Approve the pending `release` deployment in the run's page on GitHub.

The workflow then runs `make check-version` to confirm the tag agrees with both
declared versions, runs `make sign`, and attaches the signed XPI to a GitHub
release.

`make sign` signs the same staged directory `make package` archives, so the
signed and unsigned artefacts always hold identical files. It signs on the
`unlisted` channel, which self-distributes: AMO returns the signed XPI without
publishing a listing. Signing needs `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`
in the environment, which is why running the target locally fails by design.

Issue and revoke credentials on the
[AMO key management page](https://addons.mozilla.org/developers/addon/api/key/).
The secret is shown once, at creation. Rotating it means revoking the old pair
there and writing the new one straight into the GitHub environment:

```shell
gh secret set AMO_API_KEY --env release
gh secret set AMO_API_SECRET --env release
```

Both commands prompt for the value, so it never enters shell history.

## See also

- [User guide](users-guide.md)
- [ADR-0001: Preserve native undo](adr/0001-preserve-native-undo.md)
