/*
 * Background script for the Markdown Helper extension.
 *
 * Builds the "Markdown" context menu shown on editable fields and, when an
 * item is clicked, relays the chosen command plus the target element id to
 * the content script (content.js) in the originating frame, which performs
 * the actual edit using the transformations in markdown.js.
 */

(() => {
  const TAG = '[markdown-helper]';
  const OPERATION_LIMIT = 1_000_000;
  let operationSequence = 0;

  const MENU_ITEMS = [
    { id: 'quote', title: 'Toggle &Quote' },
    { id: 'bold', title: 'Toggle &Bold' },
    { id: 'italic', title: 'Toggle &Italic' },
    { id: 'code-span', title: 'Toggle Code &Span' },
    { id: 'code-block', title: 'Toggle Code Bloc&k' },
    { id: 'footnote', title: 'Convert to &Footnote' },
  ];

  browser.menus.create({
    id: 'markdown-helper',
    title: '&Markdown',
    contexts: ['editable'],
  });

  for (const { id, title } of MENU_ITEMS) {
    browser.menus.create({
      id,
      parentId: 'markdown-helper',
      title,
      contexts: ['editable'],
    });
  }

  /**
   * Relay a Markdown menu click to the originating content script.
   * @param {browser.menus.OnClickData} info Menu-click metadata.
   * @param {browser.tabs.Tab} tab Originating tab.
   * @returns {Promise<void>} Delivery completion.
   */
  async function handleMenuClick(info, tab) {
    if (typeof tab?.id !== 'number') return;
    if (info.parentMenuItemId !== 'markdown-helper') return;
    operationSequence = (operationSequence + 1) % OPERATION_LIMIT;
    const operationId = `menu-${operationSequence}`;
    const startedAt = performance.now();
    try {
      await browser.tabs.sendMessage(
        tab.id,
        {
          type: 'markdown-helper',
          command: info.menuItemId,
          targetElementId: info.targetElementId,
          operationId,
        },
        { frameId: info.frameId },
      );
      console.debug(
        TAG,
        'delivered',
        operationId,
        'in',
        Math.round(performance.now() - startedAt),
        'ms',
      );
    } catch (err) {
      console.error(
        TAG,
        'failed to deliver command',
        operationId,
        'to tab',
        tab.id,
        'frame',
        info.frameId,
        'after',
        Math.round(performance.now() - startedAt),
        'ms',
        err,
      );
    }
  }

  browser.menus.onClicked.addListener(handleMenuClick);
})();
