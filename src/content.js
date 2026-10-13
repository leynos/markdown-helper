/*
 * Applies MDHelper transformations to the right-clicked text field.
 * Edits are applied with execCommand("insertText") where possible so the
 * change lands on the browser's undo stack; setRangeText is the fallback.
 */

(() => {
  const TAG = '[markdown-helper]';

  /**
   * Return whether an element supports Markdown Helper's plain-text edits.
   * @param {object | null} el Candidate target element.
   * @returns {el is HTMLTextAreaElement | HTMLInputElement} Whether it is editable.
   */
  function isTextField(el) {
    if (!el) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) {
      return ['text', 'search', 'url'].includes(el.type);
    }
    return false;
  }

  /**
   * Restore the smallest range that makes the current field equal expected.
   * @param {HTMLTextAreaElement | HTMLInputElement} el Editable element.
   * @param {string} expected Correct field value after the edit.
   */
  function restoreExpectedValue(el, expected) {
    const current = el.value;
    let start = 0;
    while (start < current.length && current[start] === expected[start]) {
      start += 1;
    }

    let currentEnd = current.length;
    let expectedEnd = expected.length;
    while (currentEnd > start && expectedEnd > start) {
      if (current[currentEnd - 1] !== expected[expectedEnd - 1]) break;
      currentEnd -= 1;
      expectedEnd -= 1;
    }

    el.setRangeText(
      expected.slice(start, expectedEnd),
      start,
      currentEnd,
      'end',
    );
  }

  /**
   * Replace one range while preserving native undo and emitting one input event.
   * @param {HTMLTextAreaElement | HTMLInputElement} el Editable element.
   * @param {{ start: number, end: number, text: string, command: MarkdownCommand, operationId: string }} request Edit and diagnostic metadata.
   */
  function replaceRange(el, request) {
    const { start, end, text, command, operationId } = request;
    const startedAt = performance.now();
    const expected = el.value.slice(0, start) + text + el.value.slice(end);
    let inputEmitted = false;
    const markInput = () => {
      inputEmitted = true;
    };

    el.setSelectionRange(start, end);
    let ok = false;
    el.addEventListener('input', markInput);
    try {
      ok =
        text === ''
          ? document.execCommand('delete')
          : document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    } finally {
      el.removeEventListener('input', markInput);
    }

    if (el.value !== expected) {
      restoreExpectedValue(el, expected);
      console.debug(TAG, 'fallback edit', {
        operationId,
        command,
        reason: ok ? 'result-mismatch' : 'command-failed',
        editPath: 'setRangeText',
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
    if (!inputEmitted) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * Apply a command synchronously to the field associated with a menu click.
   * @param {object | null} el Candidate target element.
   * @param {MarkdownCommand} command Markdown command.
   * @param {string} operationId Bounded delivery correlation identifier.
   */
  function handleMenuClick(el, command, operationId) {
    if (!isTextField(el)) {
      console.debug(TAG, 'ignoring', command, 'on a non-text-field target');
      return;
    }

    const startedAt = performance.now();
    try {
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      const result = MDHelper.apply({
        command,
        value: el.value,
        start,
        end,
      });
      if (!result) {
        console.debug(TAG, command, 'was a no-op for the current selection');
        return;
      }

      el.focus();
      const edits = [...result.edits].sort((a, b) => b.start - a.start);
      for (const { start, end, text } of edits) {
        replaceRange(el, { start, end, text, command, operationId });
      }
      el.setSelectionRange(result.selection.start, result.selection.end);
      console.debug(TAG, 'completed', {
        command,
        operationId,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      console.error(TAG, 'failed to apply', {
        command,
        operationId,
        durationMs: Math.round(performance.now() - startedAt),
        error: err,
      });
    }
  }

  /**
   * Resolve a context-menu message to its target and apply it immediately.
   * @param {{ type?: unknown, targetElementId?: unknown, command?: unknown, operationId?: unknown }} msg Message.
   */
  function handleMessage(msg) {
    if (msg?.type !== 'markdown-helper') return;

    const command = /** @type {MarkdownCommand} */ (msg.command);
    const operationId = /** @type {string} */ (msg.operationId);
    const startedAt = performance.now();
    /** @type {object | null} */
    let el = null;
    try {
      el = browser.menus.getTargetElement(
        /** @type {number} */ (msg.targetElementId),
      );
    } catch (err) {
      console.error(TAG, 'failed to resolve target', {
        command,
        operationId,
        durationMs: Math.round(performance.now() - startedAt),
        error: err,
      });
      return;
    }
    handleMenuClick(el, command, operationId);
  }

  browser.runtime.onMessage.addListener(handleMessage);
})();
