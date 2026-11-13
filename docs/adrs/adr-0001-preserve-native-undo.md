# ADR-0001: Preserve native undo

- Status: Accepted
- Date: 2026-08-02
- Deciders: Markdown Helper maintainers

## Context and decision

In the context of applying Markdown transformations to Firefox text fields,
facing the requirement that users can undo a context-menu edit through the
field's native history,
the decision was to use a synchronous content-script edit boundary that
attempts
`document.execCommand()` and verifies its result before using
`setRangeText()`,
and against direct value assignment, unconditional `setRangeText()`, or an
asynchronous edit pipeline,
to preserve Firefox's undo integration while retaining a dependable fallback
and exactly one `input` event per edit,
accepting dependence on deprecated `execCommand()` behaviour until Firefox
provides an equivalent undo-preserving plain-text editing API.

## Consequences

- Message handling resolves the target, then calls a synchronous
  `handleMenuClick(element, command, operationId)` function without awaiting
  other work.
- Each replacement observes native `input` delivery and synthesizes an event
  only when the completed edit remained silent.
- Wiring tests cover native success, silent native success, no-op verification,
  and fallback behaviour.
- Bounded operation IDs correlate delivery and completion diagnostics without
  including selected text or other text payloads.

## Addendum: 2026-10-14 — delivery correlation and observability

The delivery-correlation change in commit `fa94e71` added a bounded
`operationId` to the background message and to the synchronous
`handleMenuClick(element, command, operationId)` content-side handler.
The accepted native-undo decision remains in force: target resolution and
editing stay synchronous, native edits are verified, and `setRangeText()`
remains the fallback with one input notification per replacement.

The subsequent observability change adds synchronous, context-local metrics
and span diagnostics around delivery, target resolution, apply, and edit.
The message carries the correlation ID across the asynchronous delivery
boundary; IDs are span fields rather than metric labels. Fixed outcome and
reason labels, saturating counters, and fixed latency buckets bound memory.
Neither text payloads nor selected text enter metrics or spans. These changes
introduce no await into the content-side edit boundary and do not change
Firefox undo semantics or guarantee native undo for fallback edits.
