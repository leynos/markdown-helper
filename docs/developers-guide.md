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

The extension uses four browser scripts. `src/telemetry.js` loads first in
both background and content contexts; it supplies synchronous metrics and spans:

1. `src/background.js` registers the parent context menu and six child items.
   A click sends a message body with `type`, `command`, `targetElementId`, and
   `operationId` to the originating tab. The `frameId` is passed separately
   in the `browser.tabs.sendMessage()` options.
2. `src/content.js` resolves that identifier with
   `browser.menus.getTargetElement()`, validates the field, and invokes the
   synchronous `handleMenuClick(element, command, operationId)` boundary.
3. `src/markdown.js` calculates immutable text edits and the selection that
   should remain after those edits.

`src/markdown.js` is an IIFE that provides the `MDHelper` browser-global
binding. `MDHelper.apply({ command, value, start, end })` is its transformation
API. The request fields are read-only, and `command` is one of `quote`, `bold`,
`italic`, `code-span`, `code-block` or `footnote`. It returns `null` for a no-op
or a result with non-overlapping `edits` in original string coordinates plus
the final `selection`. The content script applies edits from the highest offset
to the lowest so earlier ranges stay valid. A guarded CommonJS export makes
the IIFE available to Node tests; helpers such as `applyToString()` and
`nextFootnoteLabel()` are test-facing internal exports, not part of the public
browser contract.

The content script attempts `document.execCommand()` first because Firefox can
place that edit on the field's native undo stack. It verifies the resulting
value and falls back to `setRangeText()` if the command fails or changes
nothing. An input-event observer prevents duplicate notifications when the
native path emits `input`; the content script synthesizes one event only when
the completed edit remained silent. See
[ADR-0001](adr/0001-preserve-native-undo.md).

## Message delivery policy

For each accepted Markdown menu click, the background script awaits exactly
one tracked message delivery. Delivery is best effort: failures are logged and
dropped, with no retry or deduplication because repeated clicks are intentional
toggles. Separate operations have no ordering guarantee. Operation IDs and
elapsed-time measurements provide bounded correlation only; they contain no
selected text or other text payload. An in-flight message is not durably queued:
if the browser or extension context terminates before delivery completes, the
message may be lost and is not retried.

Background and content scripts emit structured diagnostics for delivery,
completion, failures, and fallback edits. These include the command,
`operationId`, `durationMs`, and, where applicable, an error or fallback reason.
They do not log selected text or message payloads. This is correlation logging,
not durable tracing: it adds no persistent trace storage or delivery guarantee.

`MDTelemetry.start(stage, operationId)` emits paired `span-start` and
`span-end` diagnostics with the propagated correlation ID. Delivery spans
cover the awaited send; target, apply, and edit spans stay synchronous. Metrics
use only the fixed stages (`delivery`, `target`, `apply`, `edit`), outcomes
(`success`, `failure`, `noop`, `ignored`, `fallback`), and reasons declared in
`src/telemetry.js`. IDs are never metric labels. `MDTelemetry.snapshot()`
returns detached context-local aggregates: counts, summed milliseconds, and
exclusive latency buckets at 1, 10, 100, 1000 ms, plus overflow. Counts and sums
saturate at one billion; there are at most 140 label combinations. These reset
when the extension context unloads and have no network exporter. Invalid IDs
become `menu-invalid` in spans. Metrics and spans contain no field values,
selected text, URLs, or error messages.

## Reproduce the code-span property

`make test` includes `test/code-span-properties.test.js`, which uses fast-check
with seed `0xc0de` and 1,000 cases. It generates multiple backtick runs,
optional edge backticks, and varied prefix/suffix lengths to exercise valid
selections. It checks fence dominance, edge padding, selection coordinates,
and double-toggle restoration. On failure fast-check reports the seed and
shrink path; replay by passing those values to `fc.assert` in that test. The
shrunk edge-backtick failure is also preserved as an example regression.

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

## Run the Firefox browser test

Install Firefox 140.4.0 ESR and geckodriver 0.36.0, then run:

```shell
make test-e2e
```

Both tools must be on `PATH`. Alternatively set `FIREFOX_BINARY` and
`GECKODRIVER` to their executable paths. The test runs Firefox headlessly in a
fresh WebDriver profile, installs the packaged `dist/markdown-helper.xpi`
temporarily, and serves `test/browser/editor.html` on a loopback port. It
selects text in a textarea and a text input, opens Firefox's real context menu,
and activates **Markdown > Toggle Bold** using the menu item's native XUL
`doCommand()` method through browser-chrome WebDriver access. Repeated
headless WebDriver pointer clicks failed to dispatch the second menu command
in either field order, so native command activation keeps both scenarios
deterministic while exercising the actual `browser.menus.onClicked` listener.
It asserts the resulting value, selection, and exactly one bubbling input
event for each field. It never calls an extension listener or sends a synthetic
extension message. Firefox's `--allow-system-access` permission is confined to
this disposable test session; the browser and driver stop when the test ends.

The [Test workflow](../.github/workflows/test.yml) runs this gate after the
sequential unit gates on every pull request and push to `main`. Browser errors
fail the gate, and a failed interaction saves a screenshot under
`dist/browser-e2e/` for the workflow artefact. `agent-browser` uses Chromium's
CDP protocol, so geckodriver supplies the Firefox-specific privileged menu
interaction this test requires.

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
`src/globals.d.ts` describes the shared `MDHelper` and `MDTelemetry` browser
globals.

## Build and inspect the package

Run:

```shell
make package
```

The target reruns the tests and creates `dist/markdown-helper.xpi`. The archive
contains `manifest.json`, the four browser scripts, the packaged icon sizes,
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
