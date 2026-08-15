/*
 * Behavioural tests for the extension wiring: the context-menu setup and
 * message routing in src/background.js, and the message handling, text-field
 * filtering, edit application, and replaceRange fallback in src/content.js.
 *
 * The scripts are plain browser scripts, not modules, so each test loads
 * the real source into a node:vm sandbox with a stubbed `browser` API and
 * fake DOM classes, then drives the captured listeners directly.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MDHelper = require('../src/markdown.js');

const read = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');

// ------------------------------------------------------------------
// Fakes
// ------------------------------------------------------------------

class FakeEvent {
  constructor(type, opts) {
    this.type = type;
    Object.assign(this, opts);
  }
}

class FakeTextArea {
  constructor(value) {
    this.value = value;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.focused = false;
    this.dispatched = [];
    this.listeners = new Map();
  }

  focus() {
    this.focused = true;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  setRangeText(text, start, end, mode) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    if (mode === 'end') {
      this.selectionStart = this.selectionEnd = start + text.length;
    }
  }

  dispatchEvent(event) {
    this.dispatched.push(event);
    for (const listener of this.listeners.get(event.type) || []) {
      listener(event);
    }
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }
}

class FakeInput extends FakeTextArea {
  constructor(value, type = 'text') {
    super(value);
    this.type = type;
  }
}

/** Return the text an execCommand invocation would insert, if any. */
function execCommandReplacement(command, text) {
  if (command === 'delete') return '';
  if (command === 'insertText' && text) return text;
  return null;
}

/** Apply a successful fake execCommand edit and optionally emit native input. */
function applyExecCommandEdit(target, replacement, emitInput) {
  target.setRangeText(
    replacement,
    target.selectionStart,
    target.selectionEnd,
    'end',
  );
  if (emitInput) {
    target.dispatchEvent(
      new FakeEvent('input', { bubbles: true, isTrusted: true }),
    );
  }
}

/**
 * Load src/content.js into a sandbox wired to `target`.
 * execCommandOk controls whether the fake document.execCommand succeeds
 * (editing via the element's current selection) or reports failure so the
 * setRangeText fallback runs.
 */
function loadContentScript(
  target,
  {
    execCommandOk = true,
    execCommandEdits = true,
    execCommandEmitsInput = true,
  } = {},
) {
  const captured = { listener: null, logs: [], errors: [], execCommands: [] };
  const sandbox = {
    MDHelper,
    Event: FakeEvent,
    HTMLTextAreaElement: FakeTextArea,
    HTMLInputElement: FakeInput,
    console: {
      debug: (...args) => captured.logs.push(args),
      error: (...args) => captured.errors.push(args),
    },
    document: {
      execCommand(command, _ui, text) {
        captured.execCommands.push({ command, text });
        if (!execCommandOk) return false;
        if (!execCommandEdits) return true;
        const replacement = execCommandReplacement(command, text);
        if (replacement === null) return true;
        applyExecCommandEdit(target, replacement, execCommandEmitsInput);
        return true;
      },
    },
    browser: {
      runtime: {
        onMessage: {
          addListener: (fn) => {
            captured.listener = fn;
          },
        },
      },
      menus: {
        getTargetElement: () => target,
      },
    },
  };
  vm.runInNewContext(read('content.js'), sandbox, { filename: 'content.js' });
  return captured;
}

/** Load src/background.js into a sandbox with a recording browser stub. */
function loadBackgroundScript({ sendMessageImpl } = {}) {
  const captured = {
    created: [],
    clickListener: null,
    sent: [],
    errors: [],
  };
  const sandbox = {
    console: {
      error: (...args) => captured.errors.push(args),
    },
    browser: {
      menus: {
        create: (spec) => captured.created.push(spec),
        onClicked: {
          addListener: (fn) => {
            captured.clickListener = fn;
          },
        },
      },
      tabs: {
        sendMessage: (tabId, msg, opts) => {
          captured.sent.push({ tabId, msg, opts });
          return sendMessageImpl
            ? sendMessageImpl(tabId, msg, opts)
            : Promise.resolve();
        },
      },
    },
  };
  vm.runInNewContext(read('background.js'), sandbox, {
    filename: 'background.js',
  });
  return captured;
}

const message = (command) => ({
  type: 'markdown-helper',
  command,
  targetElementId: 7,
});

// Values built inside the vm sandbox carry that realm's prototypes, which
// deepStrictEqual rejects; strip them before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

// ------------------------------------------------------------------
// content.js
// ------------------------------------------------------------------

test('content script applies a command and sets the selection', () => {
  const el = new FakeTextArea('say hello there');
  el.setSelectionRange(4, 9);
  const { listener, execCommands } = loadContentScript(el);
  listener(message('bold'));
  assert.deepEqual(execCommands, [
    { command: 'insertText', text: '**hello**' },
  ]);
  assert.equal(el.value, 'say **hello** there');
  assert.equal(el.focused, true);
  assert.equal(el.selectionStart, 6);
  assert.equal(el.selectionEnd, 11);
  const inputs = el.dispatched.filter((event) => event.type === 'input');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].isTrusted, true);
});

test('content script applies multi-edit commands (footnote)', () => {
  const el = new FakeTextArea('note this please');
  el.setSelectionRange(5, 9);
  const { listener } = loadContentScript(el);
  listener(message('footnote'));
  assert.equal(el.value, 'note [^1] please\n\n[^1]: this\n');
  assert.equal(el.selectionStart, 9);
  assert.equal(el.selectionEnd, 9);
});

test('content script falls back to setRangeText and fires input', () => {
  const el = new FakeTextArea('say hello there');
  el.setSelectionRange(4, 9);
  const { listener } = loadContentScript(el, { execCommandOk: false });
  listener(message('bold'));
  assert.equal(el.value, 'say **hello** there');
  const inputs = el.dispatched.filter((event) => event.type === 'input');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].bubbles, true);
  assert.equal(inputs[0].isTrusted, undefined);
});

test('content script synthesizes one input when native editing is silent', () => {
  const el = new FakeTextArea('say hello there');
  el.setSelectionRange(4, 9);
  const { listener } = loadContentScript(el, {
    execCommandEmitsInput: false,
  });
  listener(message('bold'));
  assert.equal(el.value, 'say **hello** there');
  assert.equal(
    el.dispatched.filter((event) => event.type === 'input').length,
    1,
  );
});

test('content script falls back when execCommand reports a no-op', () => {
  const el = new FakeTextArea('say hello there');
  el.setSelectionRange(4, 9);
  const { listener } = loadContentScript(el, { execCommandEdits: false });
  listener(message('bold'));
  assert.equal(el.value, 'say **hello** there');
  assert.equal(
    el.dispatched.filter((event) => event.type === 'input').length,
    1,
  );
});

test('content script accepts single-line text inputs', () => {
  const el = new FakeInput('say hello there', 'text');
  el.setSelectionRange(4, 9);
  const { listener } = loadContentScript(el);
  listener(message('italic'));
  assert.equal(el.value, 'say *hello* there');
});

test('content script ignores non-text targets', () => {
  const el = { value: 'untouched' };
  const { listener, logs } = loadContentScript(el);
  listener(message('bold'));
  assert.equal(el.value, 'untouched');
  assert.ok(logs.length > 0);
});

test('content script ignores unrelated messages', () => {
  const el = new FakeTextArea('say hello there');
  el.setSelectionRange(4, 9);
  const { listener } = loadContentScript(el);
  listener({ type: 'other', command: 'bold' });
  listener(null);
  assert.equal(el.value, 'say hello there');
});

test('content script logs unknown commands instead of throwing', () => {
  const el = new FakeTextArea('say hello there');
  el.setSelectionRange(4, 9);
  const { listener, errors } = loadContentScript(el);
  listener(message('explode'));
  assert.equal(el.value, 'say hello there');
  assert.equal(errors.length, 1);
});

// ------------------------------------------------------------------
// background.js
// ------------------------------------------------------------------

test('background script creates the parent menu and six commands', () => {
  const { created } = loadBackgroundScript();
  const parent = created.find((m) => m.id === 'markdown-helper');
  assert.ok(parent);
  assert.deepEqual(plain(parent.contexts), ['editable']);
  const children = created.filter((m) => m.parentId === 'markdown-helper');
  assert.deepEqual(children.map((m) => m.id).sort(), [
    'bold',
    'code-block',
    'code-span',
    'footnote',
    'italic',
    'quote',
  ]);
});

test('background script routes clicks to the right tab and frame', () => {
  const { clickListener, sent } = loadBackgroundScript();
  clickListener(
    {
      parentMenuItemId: 'markdown-helper',
      menuItemId: 'quote',
      targetElementId: 42,
      frameId: 3,
    },
    { id: 9 },
  );
  assert.deepEqual(plain(sent), [
    {
      tabId: 9,
      msg: { type: 'markdown-helper', command: 'quote', targetElementId: 42 },
      opts: { frameId: 3 },
    },
  ]);
});

test('background script ignores clicks from other menus', () => {
  const { clickListener, sent } = loadBackgroundScript();
  clickListener({ parentMenuItemId: 'other', menuItemId: 'quote' }, { id: 9 });
  clickListener({ parentMenuItemId: 'markdown-helper', menuItemId: 'bold' });
  assert.equal(sent.length, 0);
});

test('background script logs message-delivery failures', async () => {
  const captured = loadBackgroundScript({
    sendMessageImpl: () => Promise.reject(new Error('no receiver')),
  });
  captured.clickListener(
    {
      parentMenuItemId: 'markdown-helper',
      menuItemId: 'bold',
      targetElementId: 1,
      frameId: 0,
    },
    { id: 4 },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captured.errors.length, 1);
});
