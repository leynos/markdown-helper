/* Exercise the packaged extension through Firefox's real context menu. */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const ROOT = path.resolve(__dirname, '..');
const WAIT_MS = 10_000;

async function waitFor(read, description) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

class WebDriver {
  constructor(port) {
    this.endpoint = `http://127.0.0.1:${port}`;
    this.session = undefined;
  }

  async request(method, route, body) {
    const response = await fetch(`${this.endpoint}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(`${method} ${route}: ${JSON.stringify(result.value)}`);
    }
    return result.value;
  }

  command(route, body) {
    return this.request('POST', `/session/${this.session}${route}`, body);
  }

  execute(script, args = []) {
    return this.command('/execute/sync', { script, args });
  }

  async installPackage() {
    const options = {
      args: ['-headless'],
      prefs: {
        'browser.shell.checkDefaultBrowser': false,
        'devtools.console.stdout.content': true,
        'devtools.console.stdout.chrome': true,
      },
    };
    if (process.env.FIREFOX_BINARY) options.binary = process.env.FIREFOX_BINARY;
    const created = await this.request('POST', '/session', {
      capabilities: {
        alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': options },
      },
    });
    this.session = created.sessionId;
    console.log(`Firefox ${created.capabilities.browserVersion}`);
    const addon = await this.command('/moz/addon/install', {
      path: path.join(ROOT, 'dist/markdown-helper.xpi'),
      temporary: true,
    });
    assert.equal(addon, 'markdown-helper@df12.net');
  }

  async close() {
    if (this.session) {
      await this.request('DELETE', `/session/${this.session}`).catch(
        console.error,
      );
    }
  }
}

async function clickBoldMenu(driver) {
  await driver.command('/moz/context', { context: 'chrome' });
  await waitFor(
    () =>
      driver.execute(
        `const popup = document.getElementById('contentAreaContextMenu');
     const menu = [...popup.querySelectorAll('menu')].find(
       node => (node.getAttribute('label') || '').replaceAll('&', '') === 'Markdown');
     if (popup.state !== 'open' || !menu) return false;
     menu.openMenu(true);
     return true;`,
      ),
    'Markdown submenu',
  );
  const item = await waitFor(
    () =>
      driver.execute(
        `const item = [...document.querySelectorAll('#contentAreaContextMenu menuitem')].find(
       node => (node.getAttribute('label') || '').replaceAll('&', '') === 'Toggle Bold');
     return item && item.parentNode.state === 'open' ? item : null;`,
      ),
    'Toggle Bold menu item',
  );
  // XUL's native command activation dispatches the real menus.onClicked
  // event. Repeated headless WebDriver pointer clicks do not reliably do so.
  // No extension listener or synthetic extension message is called here.
  await driver.execute(
    `const item = arguments[0];
     if (item.disabled || item.parentNode.state !== 'open') {
       throw new Error('Markdown command is not available');
     }
     item.doCommand();
     document.getElementById('contentAreaContextMenu').hidePopup();`,
    [item],
  );
  await waitFor(
    () =>
      driver.execute(
        "return document.getElementById('contentAreaContextMenu').state === 'closed';",
      ),
    'context menu closure',
  );
  await driver.command('/moz/context', { context: 'content' });
}

async function exerciseField(driver, pagePort, fieldId) {
  // Each scenario starts with a new document and fresh context-menu targets.
  await driver.command('/url', {
    url: `http://127.0.0.1:${pagePort}/editor.html?field=${fieldId}`,
  });
  const field = await driver.command('/element', {
    using: 'css selector',
    value: `#${fieldId}`,
  });
  const point = await driver.execute(
    `const field = arguments[0];
     field.focus();
     field.setSelectionRange(0, 5);
     window.inputEvents.length = 0;
     const bounds = field.getBoundingClientRect();
     return {x: Math.round(bounds.x + 12), y: Math.round(bounds.y + 10)};`,
    [field],
  );
  await driver.command('/actions', {
    actions: [
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            origin: 'viewport',
            x: point.x,
            y: point.y,
            duration: 0,
          },
          { type: 'pointerDown', button: 2 },
          { type: 'pointerUp', button: 2 },
        ],
      },
    ],
  });
  await clickBoldMenu(driver);
  await waitFor(
    () =>
      driver.execute('return arguments[0].value === "**hello** world";', [
        field,
      ]),
    `${fieldId} edit`,
  );
  const actual = await driver.execute(
    `return {value: arguments[0].value,
      selection: [arguments[0].selectionStart, arguments[0].selectionEnd],
      events: window.inputEvents};`,
    [field],
  );
  assert.deepEqual(actual, {
    value: '**hello** world',
    selection: [2, 7],
    events: [{ target: fieldId, bubbles: true }],
  });
  console.log(
    `PASS ${fieldId}: real context-menu edit, selection, one input event`,
  );
}

async function captureFailure(driver) {
  if (!driver.session) return;
  const artifacts = path.join(ROOT, 'dist/browser-e2e');
  await fs.mkdir(artifacts, { recursive: true });
  try {
    await driver.command('/moz/context', { context: 'content' });
    const fields = await driver.execute(
      `return {fields: [...document.querySelectorAll('textarea, input')].map(
         field => ({id: field.id, value: field.value,
           selection: [field.selectionStart, field.selectionEnd]})),
         events: window.inputEvents};`,
    );
    console.error('Firefox field state at failure:', JSON.stringify(fields));
    await fs.writeFile(
      path.join(artifacts, 'failure-fields.json'),
      JSON.stringify(fields, null, 2),
    );
    const screenshot = await driver.request(
      'GET',
      `/session/${driver.session}/screenshot`,
    );
    await fs.writeFile(
      path.join(artifacts, 'failure.png'),
      Buffer.from(screenshot, 'base64'),
    );
  } catch (error) {
    console.error('Could not capture Firefox failure:', error);
  }
}

async function main() {
  const fixture = await fs.readFile(
    path.join(ROOT, 'test/browser/editor.html'),
  );
  const page = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fixture);
  });
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const service = spawn(
    process.env.GECKODRIVER || 'geckodriver',
    ['--port', String(port), '--host', '127.0.0.1', '--allow-system-access'],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  let launchError;
  service.on('error', (error) => {
    launchError = error;
  });
  const driver = new WebDriver(port);
  try {
    const pagePort = await listen(page);
    await waitFor(async () => {
      if (launchError) throw launchError;
      if (service.exitCode !== null) {
        throw new Error(`geckodriver exited: ${service.exitCode}`);
      }
      try {
        return (await driver.request('GET', '/status')).ready;
      } catch {
        return false;
      }
    }, 'geckodriver startup');
    await driver.installPackage();
    for (const fieldId of ['textarea', 'input']) {
      await exerciseField(driver, pagePort, fieldId);
    }
  } catch (error) {
    await captureFailure(driver);
    throw error;
  } finally {
    await driver.close();
    if (service.exitCode === null && !launchError) {
      const stopped = once(service, 'exit');
      service.kill('SIGTERM');
      await stopped;
    }
    await new Promise((resolve) => page.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
