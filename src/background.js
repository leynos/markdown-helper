'use strict';

/*
 * Background script for the Markdown Helper extension.
 *
 * Builds the "Markdown" context menu shown on editable fields and, when an
 * item is clicked, relays the chosen command plus the target element id to
 * the content script (content.js) in the originating frame, which performs
 * the actual edit using the transformations in markdown.js.
 */

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

browser.menus.onClicked.addListener((info, tab) => {
  if (!tab || info.parentMenuItemId !== 'markdown-helper') return;
  browser.tabs
    .sendMessage(
      tab.id,
      {
        type: 'markdown-helper',
        command: info.menuItemId,
        targetElementId: info.targetElementId,
      },
      { frameId: info.frameId }
    )
    .catch((err) =>
      console.error(
        '[markdown-helper] failed to deliver command',
        info.menuItemId,
        'to tab',
        tab.id,
        'frame',
        info.frameId,
        err
      )
    );
});
