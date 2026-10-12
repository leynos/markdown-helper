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

class FakeTextControl {
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

class FakeTextArea extends FakeTextControl {}

class FakeInput extends FakeTextControl {
  constructor(value, type = 'text') {
    super(value);
    this.type = type;
  }
}

/** Return the text an execCommand invocation would insert, if any. */
function execCommandReplacement(command, text, execCommandEdits) {
  if (!execCommandEdits) return null;
  if (command === 'delete') return '';
  if (command === 'insertText' && text !== '') return text;
  return null;
}

/** Apply a successful fake execCommand edit and optionally emit native input. */
function applyNativeEdit(target, replacement, execCommandEmitsInput) {
  target.setRangeText(
    replacement,
    target.selectionStart,
    target.selectionEnd,
    'end',
  );
  if (execCommandEmitsInput) {
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
    performance: { now: () => 0 },
    document: {
      execCommand(command, _ui, text) {
        captured.execCommands.push({ command, text });
        if (!execCommandOk) return false;
        const replacement = execCommandReplacement(
          command,
          text,
          execCommandEdits,
        );
        if (replacement === null) return true;
        applyNativeEdit(target, replacement, execCommandEmitsInput);
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
        getTargetElement: (targetElementId) => {
          if (targetElementId === 'unavailable') {
            throw new Error('target unavailable');
          }
          return target;
        },
      },
    },
  };
  vm.runInNewContext(read('content.js'), sandbox, { filename: 'content.js' });
  return captured;
}

/** Load src/background.js into a sandbox with a recording browser stub. */
function loadBackgroundScript({
  sendMessageImpl,
  operationLimit = 1_000_000,
} = {}) {
  const captured = {
    created: [],
    clickListener: null,
    sent: [],
    logs: [],
    errors: [],
  };
  const sandbox = {
    console: {
      debug: (...args) => captured.logs.push(args),
      error: (...args) => captured.errors.push(args),
    },
    performance: { now: () => 0 },
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
  const source = read('background.js').replace(
    'const OPERATION_LIMIT = 1_000_000;',
    `const OPERATION_LIMIT = ${operationLimit};`,
  );
  vm.runInNewContext(source, sandbox, {
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
  const { listener, execCommands, logs } = loadContentScript(el);
  listener({ ...message('bold'), operationId: 'menu-5' });
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
  const completed = logs.find(([, event]) => event === 'completed');
  assert.deepEqual(plain(completed[2]), {
    command: 'bold',
    operationId: 'menu-5',
    durationMs: 0,
  });
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

test('content script repairs incorrect native output with one input event', () => {
  const el = new FakeTextArea('say hello there');
  el.setSelectionRange(4, 9);
  const setRangeText = el.setRangeText.bind(el);
  let nativeEdit = true;
  el.setRangeText = (text, start, end, mode) => {
    if (nativeEdit) {
      nativeEdit = false;
      setRangeText(text.replaceAll('*', '#'), start, end, mode);
      return;
    }
    setRangeText(text, start, end, mode);
  };

  const { listener, logs, execCommands } = loadContentScript(el);
  listener({ ...message('bold'), operationId: 'menu-11' });

  assert.deepEqual(execCommands, [
    { command: 'insertText', text: '**hello**' },
  ]);
  assert.equal(el.value, 'say **hello** there');
  assert.equal(el.selectionStart, 6);
  assert.equal(el.selectionEnd, 11);
  const inputs = el.dispatched.filter((event) => event.type === 'input');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].isTrusted, true);
  const fallback = logs.find(([, event]) => event === 'fallback edit');
  assert.deepEqual(plain(fallback[2]), {
    operationId: 'menu-11',
    command: 'bold',
    reason: 'result-mismatch',
    editPath: 'setRangeText',
    durationMs: 0,
  });
  assert.equal(JSON.stringify(fallback).includes('hello'), false);
});

test('content script accepts single-line text inputs', () => {
  const el = new FakeInput('say hello there', 'text');
  el.setSelectionRange(4, 9);
  const { listener } = loadContentScript(el);
  listener(message('italic'));
  assert.equal(el.value, 'say *hello* there');
});

test('content script accepts search and URL inputs but excludes passwords', () => {
  for (const type of ['search', 'url']) {
    const el = new FakeInput('say hello there', type);
    el.setSelectionRange(4, 9);
    const { listener } = loadContentScript(el);
    listener(message('italic'));
    assert.equal(el.value, 'say *hello* there');
  }

  const password = new FakeInput('secret value', 'password');
  password.setSelectionRange(0, 6);
  const { listener, execCommands } = loadContentScript(password);
  listener(message('bold'));
  assert.equal(password.value, 'secret value');
  assert.equal(execCommands.length, 0);
});

test('content script wires quote, code-span, and code-block transformations', () => {
  const cases = [
    { command: 'quote', value: 'alpha\nbeta', start: 0, end: 10 },
    { command: 'code-span', value: 'hello world', start: 0, end: 5 },
    { command: 'code-block', value: 'alpha\nbeta', start: 0, end: 5 },
  ];

  for (const { command, value, start, end } of cases) {
    const result = MDHelper.apply({ command, value, start, end });
    assert.ok(result, `${command} should produce an edit`);
    const el = new FakeTextArea(value);
    el.setSelectionRange(start, end);
    const { listener } = loadContentScript(el);
    listener(message(command));
    assert.equal(el.value, MDHelper.applyToString(value, result), command);
    assert.deepEqual(
      [el.selectionStart, el.selectionEnd],
      [result.selection.start, result.selection.end],
      command,
    );
  }
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

test('content script correlates apply errors with operation timing', () => {
  const el = new FakeTextArea('say hello there');
  el.focus = () => {
    throw new Error('focus failed');
  };
  const { listener, errors } = loadContentScript(el);
  listener({ ...message('bold'), operationId: 'menu-7' });
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0].slice(0, 2), [
    '[markdown-helper]',
    'failed to apply',
  ]);
  assert.equal(errors[0][2].command, 'bold');
  assert.equal(errors[0][2].operationId, 'menu-7');
  assert.equal(errors[0][2].durationMs, 0);
  assert.equal(errors[0][2].error.message, 'focus failed');
  assert.equal(errors[0].includes('say hello there'), false);
});

test('content script logs target-resolution failures with correlation', () => {
  const { listener, errors } = loadContentScript(null);
  listener({
    ...message('bold'),
    targetElementId: 'unavailable',
    operationId: 'menu-12',
  });
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0].slice(0, 2), [
    '[markdown-helper]',
    'failed to resolve target',
  ]);
  assert.equal(errors[0][2].command, 'bold');
  assert.equal(errors[0][2].operationId, 'menu-12');
  assert.equal(errors[0][2].durationMs, 0);
  assert.equal(errors[0][2].error.message, 'target unavailable');
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

test('background script routes clicks to the right tab and frame', async () => {
  const { clickListener, sent, logs } = loadBackgroundScript();
  await clickListener(
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
      msg: {
        type: 'markdown-helper',
        command: 'quote',
        targetElementId: 42,
        operationId: 'menu-1',
      },
      opts: { frameId: 3 },
    },
  ]);
  const delivered = logs.find(([, event]) => event === 'delivered');
  assert.deepEqual(plain(delivered[2]), {
    command: 'quote',
    operationId: 'menu-1',
    durationMs: 0,
  });
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
  await captured.clickListener(
    {
      parentMenuItemId: 'markdown-helper',
      menuItemId: 'bold',
      targetElementId: 1,
      frameId: 0,
    },
    { id: 4 },
  );
  assert.equal(captured.errors.length, 1);
  assert.deepEqual(plain(captured.errors[0][2]), {
    command: 'bold',
    operationId: 'menu-1',
    tabId: 4,
    frameId: 0,
    durationMs: 0,
    error: {},
  });
  assert.equal(captured.errors[0][2].error.message, 'no receiver');
});

test('background script wraps bounded operation identifiers', async () => {
  const { clickListener, sent } = loadBackgroundScript({ operationLimit: 3 });
  for (let i = 0; i < 4; i += 1) {
    await clickListener(
      {
        parentMenuItemId: 'markdown-helper',
        menuItemId: 'bold',
        targetElementId: 1,
        frameId: 0,
      },
      { id: 4 },
    );
  }
  assert.deepEqual(plain(sent.map(({ msg }) => msg.operationId)), [
    'menu-1',
    'menu-2',
    'menu-0',
    'menu-1',
  ]);
});

test('background tracks repeated and out-of-order delivery completion', async () => {
  const resolvers = [];
  const captured = loadBackgroundScript({
    sendMessageImpl: () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  });
  const click = (command) =>
    captured.clickListener(
      {
        parentMenuItemId: 'markdown-helper',
        menuItemId: command,
        targetElementId: 1,
        frameId: 0,
      },
      { id: 4 },
    );

  const first = click('bold');
  const second = click('italic');
  assert.deepEqual(plain(captured.sent.map(({ msg }) => msg.operationId)), [
    'menu-1',
    'menu-2',
  ]);
  resolvers[1]();
  resolvers[0]();
  await Promise.all([first, second]);
  assert.equal(captured.logs.length, 2);
});

test('content script drops a message whose target tore down', () => {
  const { listener, logs } = loadContentScript(null);
  listener(message('bold'));
  assert.equal(logs.length, 1);
});
