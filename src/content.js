'use strict';

/*
 * Applies MDHelper transformations to the right-clicked text field.
 * Edits are applied with execCommand("insertText") where possible so the
 * change lands on the browser's undo stack; setRangeText is the fallback.
 */

function isTextField(el) {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return ['text', 'search', 'url'].includes(el.type);
  }
  return false;
}

function replaceRange(el, start, end, text) {
  el.setSelectionRange(start, end);
  let ok = false;
  try {
    ok =
      text === ''
        ? document.execCommand('delete')
        : document.execCommand('insertText', false, text);
  } catch (e) {
    ok = false;
  }
  if (!ok || el.value.slice(start, start + text.length) !== text) {
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const TAG = '[markdown-helper]';

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'markdown-helper') return;

  const el = browser.menus.getTargetElement(msg.targetElementId);
  if (!isTextField(el)) {
    console.debug(TAG, 'ignoring', msg.command, 'on a non-text-field target');
    return;
  }

  try {
    const result = MDHelper.apply(
      msg.command,
      el.value,
      el.selectionStart,
      el.selectionEnd
    );
    if (!result) {
      console.debug(TAG, msg.command, 'was a no-op for the current selection');
      return;
    }

    el.focus();
    const edits = [...result.edits].sort((a, b) => b.start - a.start);
    for (const { start, end, text } of edits) {
      replaceRange(el, start, end, text);
    }
    el.setSelectionRange(result.selection.start, result.selection.end);
  } catch (err) {
    console.error(TAG, 'failed to apply', msg.command, err);
  }
});
