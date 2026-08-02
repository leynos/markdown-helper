# ADR-0001: Preserve native undo

- Status: Accepted
- Date: 2026-08-02
- Deciders: Markdown Helper maintainers

## Context and decision

In the context of applying Markdown transformations to Firefox text fields,
facing the requirement that users can undo a context-menu edit through the
field's native history,
we decided for a synchronous content-script edit boundary that attempts
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
  `handleMenuClick(element, command)` function without awaiting other work.
- Each replacement observes native `input` delivery and synthesizes an event
  only when the completed edit remained silent.
- Wiring tests cover native success, silent native success, no-op verification,
  and fallback behavior.
