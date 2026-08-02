/*
 * Applies MDHelper transformations to the right-clicked text field.
 * Edits are applied with execCommand("insertText") where possible so the
 * change lands on the browser's undo stack; setRangeText is the fallback.
 */

(() => {
  /** Return whether an element supports Markdown Helper's plain-text edits. */
  function isTextField(el) {
    if (!el) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) {
      return ['text', 'search', 'url'].includes(el.type);
    }
    return false;
  }

  /** Replace one range while preserving native undo and emitting one input event. */
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

  /** Apply a command synchronously to the field associated with a menu click. */
  function handleMenuClick(el, command) {
    if (!isTextField(el)) {
      console.debug(TAG, 'ignoring', command, 'on a non-text-field target');
      return;
    }

    try {
      const result = MDHelper.apply(
        command,
        el.value,
        el.selectionStart,
        el.selectionEnd,
      );
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
    } catch (err) {
      console.error(TAG, 'failed to apply', command, err);
    }
  }

  /** Resolve a context-menu message to its target and apply it immediately. */
  function handleMessage(msg) {
    if (msg?.type !== 'markdown-helper') return;

    const el = browser.menus.getTargetElement(msg.targetElementId);
    handleMenuClick(el, msg.command);
  }

  browser.runtime.onMessage.addListener(handleMessage);
})();
