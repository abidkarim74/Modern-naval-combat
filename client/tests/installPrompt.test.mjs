import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/pwa/InstallPromptController.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { InstallPromptController } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture(t, { ios = false, ipad = false, standalone = false, appleStandalone = false,
  secure = true, embedded = false, storage = new Map(), storageBlocked = false } = {}) {
  const browser = new EventTarget();
  const display = new EventTarget();
  display.matches = standalone;
  Object.assign(browser, {
    isSecureContext: secure,
    navigator: {
      userAgent: ios ? 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Safari/604.1' : 'Mozilla/5.0 Chrome/140',
      platform: ipad ? 'MacIntel' : 'Win32',
      maxTouchPoints: ipad ? 5 : 0,
      standalone: appleStandalone,
    },
    matchMedia: () => display,
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('Storage disabled'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error('Storage disabled'); storage.set(key, value); },
    },
    self: browser,
    top: embedded ? {} : browser,
  });
  const controller = new InstallPromptController(browser);
  t.after(() => controller.dispose());
  return {
    browser, display, controller, storage,
    offer({ outcome = 'accepted', throws = false, pending = false } = {}) {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      let calls = 0;
      let choose;
      event.prompt = async () => { calls++; if (throws) throw new Error('Prompt unavailable'); };
      event.userChoice = pending ? new Promise(resolve => { choose = resolve; }) : Promise.resolve({ outcome });
      browser.dispatchEvent(event);
      return { event, calls: () => calls, choose: value => choose({ outcome: value }) };
    },
  };
}

test('captures an early install event and invokes the native prompt only from install()', async t => {
  const { controller, offer } = fixture(t);
  assert.equal(controller.getSnapshot().kind, 'hidden');
  const prompt = offer();
  assert.equal(prompt.event.defaultPrevented, true);
  assert.equal(prompt.calls(), 0);
  assert.equal(controller.getSnapshot().kind, 'native');
  const before = controller.getSnapshot();
  assert.strictEqual(controller.getSnapshot(), before, 'React snapshots must remain stable until state changes');
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => notifications++);
  await controller.install();
  assert.equal(prompt.calls(), 1);
  assert.equal(controller.getSnapshot().kind, 'hidden');
  assert.ok(notifications > 0);
  unsubscribe();
  await controller.install();
  assert.equal(prompt.calls(), 1, 'accepted prompts cannot be reused');
});

test('double clicks share one prompt while awaiting the browser choice', async t => {
  const { controller, offer } = fixture(t);
  const prompt = offer({ pending: true });
  const install = controller.install();
  assert.equal(prompt.calls(), 1, 'prompt is invoked synchronously inside the click');
  assert.equal(controller.getSnapshot().installing, true);
  await controller.install();
  assert.equal(prompt.calls(), 1);
  prompt.choose('accepted');
  await install;
  assert.equal(controller.getSnapshot().installing, false);
  assert.equal(controller.getSnapshot().kind, 'hidden');
});

test('Not now persists across visits and expired dismissals allow a fresh offer', t => {
  const first = fixture(t);
  first.offer();
  first.controller.dismiss();
  assert.equal(first.controller.getSnapshot().kind, 'hidden');
  const deadline = Number(first.storage.get('naval-combat.install-dismissed-until'));
  assert.ok(deadline > Date.now() + 6 * 24 * 60 * 60 * 1000);
  assert.ok(deadline <= Date.now() + 7 * 24 * 60 * 60 * 1000);
  const next = fixture(t, { storage: first.storage });
  next.offer();
  assert.equal(next.controller.getSnapshot().kind, 'hidden');
  first.storage.set('naval-combat.install-dismissed-until', String(Date.now() - 1));
  const expired = fixture(t, { storage: first.storage });
  expired.offer();
  assert.equal(expired.controller.getSnapshot().kind, 'native');
});

test('declining the browser prompt hides the card and consumes the event', async t => {
  const { controller, offer, storage } = fixture(t);
  const prompt = offer({ outcome: 'dismissed' });
  await controller.install();
  assert.equal(controller.getSnapshot().kind, 'hidden');
  assert.ok(storage.has('naval-combat.install-dismissed-until'));
  await controller.install();
  assert.equal(prompt.calls(), 1);
});

test('iPhone and desktop-agent iPad receive manual steps without a native prompt', async t => {
  for (const options of [{ ios: true }, { ipad: true }]) {
    const { controller } = fixture(t, options);
    assert.equal(controller.getSnapshot().kind, 'ios');
    await controller.install();
    assert.equal(controller.getSnapshot().kind, 'ios');
    controller.dismiss();
    assert.equal(controller.getSnapshot().kind, 'hidden');
  }
});

test('installed windows, HTTP origins and embedded pages do not show installation suggestions', async t => {
  for (const options of [{ standalone: true }, { appleStandalone: true }, { secure: false }, { embedded: true }]) {
    const { controller, offer } = fixture(t, { ios: true, ...options });
    const prompt = offer();
    assert.equal(controller.getSnapshot().kind, 'hidden');
    await controller.install();
    assert.equal(prompt.calls(), 0);
  }
});

test('browser-menu installs and live display-mode changes remove the card', t => {
  const native = fixture(t);
  native.offer();
  native.browser.dispatchEvent(new Event('appinstalled'));
  assert.equal(native.controller.getSnapshot().kind, 'hidden');
  native.offer();
  assert.equal(native.controller.getSnapshot().kind, 'hidden');
  const apple = fixture(t, { ios: true });
  apple.display.matches = true;
  apple.display.dispatchEvent(new Event('change'));
  assert.equal(apple.controller.getSnapshot().kind, 'hidden');
});

test('blocked or malformed storage does not break installation or dismissal', async t => {
  const blocked = fixture(t, { storageBlocked: true });
  blocked.offer();
  await blocked.controller.install();
  assert.equal(blocked.controller.getSnapshot().kind, 'hidden');
  const malformed = fixture(t, { ios: true, storage: new Map([['naval-combat.install-dismissed-until', 'not-a-date']]) });
  assert.equal(malformed.controller.getSnapshot().kind, 'ios');
  const apple = fixture(t, { ios: true, storageBlocked: true });
  apple.controller.dismiss();
  assert.equal(apple.controller.getSnapshot().kind, 'hidden');
});

test('prompt failures offer manual installation help without reusing the event', async t => {
  const { controller, offer } = fixture(t);
  const prompt = offer({ throws: true });
  await controller.install();
  assert.equal(controller.getSnapshot().kind, 'native');
  assert.equal(controller.getSnapshot().installing, false);
  assert.match(controller.getSnapshot().error, /browser's Install app/);
  await controller.install();
  assert.equal(prompt.calls(), 1);
  controller.dismiss();
  assert.equal(controller.getSnapshot().kind, 'hidden');
});

test('disposing the controller removes browser and display listeners', t => {
  const { controller, offer, display, browser } = fixture(t);
  controller.dispose();
  const prompt = offer();
  display.matches = true;
  display.dispatchEvent(new Event('change'));
  browser.dispatchEvent(new Event('appinstalled'));
  assert.equal(prompt.event.defaultPrevented, false);
  assert.equal(controller.getSnapshot().kind, 'hidden');
});
