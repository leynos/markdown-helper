/*
 * Applies MDHelper transformations to the right-clicked text field.
 * Edits are applied with execCommand("insertText") where possible so the
 * change lands on the browser's undo stack; setRangeText is the fallback.
 */

(() => {
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
   * Replace one range while preserving native undo and emitting one input event.
   * @param {HTMLTextAreaElement | HTMLInputElement} el Editable element.
   * @param {number} start Replacement start.
   * @param {number} end Replacement end.
   * @param {string} text Replacement text.
   */
  function replaceRange(el, start, end, text) {
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

    if (!ok || el.value !== expected) {
      el.setRangeText(text, start, end, 'end');
    }
    if (!inputEmitted) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  const TAG = '[markdown-helper]';

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

    try {
      const startedAt = performance.now();
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
        replaceRange(el, start, end, text);
      }
      el.setSelectionRange(result.selection.start, result.selection.end);
      console.debug(
        TAG,
        'completed',
        operationId,
        'in',
        Math.round(performance.now() - startedAt),
        'ms',
      );
    } catch (err) {
      console.error(TAG, 'failed to apply', command, err);
    }
  }

  /**
   * Resolve a context-menu message to its target and apply it immediately.
   * @param {{ type?: unknown, targetElementId?: unknown, command?: unknown, operationId?: unknown }} msg Message.
   */
  function handleMessage(msg) {
    if (msg?.type !== 'markdown-helper') return;

    const el = browser.menus.getTargetElement(
      /** @type {number} */ (msg.targetElementId),
    );
    handleMenuClick(
      el,
      /** @type {MarkdownCommand} */ (msg.command),
      /** @type {string} */ (msg.operationId),
    );
  }

  browser.runtime.onMessage.addListener(handleMessage);
})();
