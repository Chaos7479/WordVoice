import { test, expect, chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
let context, worker, extensionId, server, baseURL, profile, extensionRoot, harness;
const errors = [];
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>WordVoice test page</title></head><body>
<h1>Reading practice</h1><p id="first">Hello</p><p id="second">World</p><p id="sentence">I love New York. It is a large city.</p>
<p id="cross">Good <b>morning</b>, everyone.</p><input id="input" value="hello"><textarea id="textarea">hello world</textarea><div id="editable" contenteditable="true">editable words</div><div id="shadow"></div><iframe src="/frame"></iframe></body></html>`;
async function prepareWorker(target = worker) {
  await target.evaluate(async () => {
    globalThis.__calls = [];
    globalThis.__fetches = [];
    globalThis.__delay = 0;
    globalThis.__offline = false;
    globalThis.__cloudAudio = '';
    globalThis.__meaningRequests = [];
    globalThis.__meaningDelay = 0;
    globalThis.__meaningFailure = false;
    globalThis.__meaningAborted = 0;
    globalThis.__stops = 0;
    chrome.tts.getVoices = (callback) =>
      callback([
        { voiceName: 'Albert', lang: 'en-US', remote: false, eventTypes: ['start', 'end'] },
        { voiceName: 'Samantha', lang: 'en-US', remote: false, eventTypes: ['start', 'end'] },
        {
          voiceName: 'Test English US',
          lang: 'en-US',
          remote: false,
          eventTypes: ['start', 'end'],
        },
        {
          voiceName: 'Test English UK',
          lang: 'en-GB',
          remote: false,
          eventTypes: ['start', 'end'],
        },
      ]);
    let eventCallback;
    chrome.tts.stop = () => {
      globalThis.__stops++;
      eventCallback?.({ type: 'interrupted' });
      eventCallback = null;
    };
    chrome.tts.speak = (text, options, callback) => {
      globalThis.__calls.push({
        text,
        lang: options.lang,
        rate: options.rate,
        voice: options.voiceName,
        time: Date.now(),
      });
      eventCallback = options.onEvent;
      callback?.();
      setTimeout(() => options.onEvent({ type: 'start' }), 5);
    };
    globalThis.fetch = async (input, options = {}) => {
      const url = String(input);
      globalThis.__fetches.push(url);
      if (globalThis.__offline) throw new TypeError('Failed to fetch');
      if (globalThis.__delay)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, globalThis.__delay);
          if (options.signal?.aborted) {
            clearTimeout(timer);
            reject(options.signal.reason);
            return;
          }
          options.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(options.signal.reason);
            },
            { once: true },
          );
        });
      if (url.includes('dictionaryapi.dev'))
        return new Response(
          JSON.stringify([
            {
              phonetic: '/həˈləʊ/',
              phonetics: [],
              meanings: [
                {
                  partOfSpeech: 'noun',
                  definitions: [{ definition: 'A greeting.', example: 'Hello, World.' }],
                },
              ],
            },
          ]),
        );
      if (url.includes('translate.googleapis.com'))
        return new Response(JSON.stringify([[['你好。'], ['欢迎。']]]));
      if (url.includes('t2a_v2'))
        return globalThis.__cloudAudio
          ? new Response(
              JSON.stringify({
                base_resp: { status_code: 0 },
                data: { audio: globalThis.__cloudAudio },
              }),
            )
          : new Response('', { status: 503 });
      if (url.includes('chat/completions') && options.body?.includes('你是阅读助手')) {
        const body = JSON.parse(options.body);
        const input = JSON.parse(body.messages[1].content);
        globalThis.__meaningRequests.push({ url, input, system: body.messages[0].content });
        const delay =
          typeof __meaningDelay === 'object'
            ? __meaningDelay[input.selectedText] || 0
            : __meaningDelay;
        if (delay)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            options.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                globalThis.__meaningAborted++;
                reject(options.signal.reason);
              },
              { once: true },
            );
          });
        if (__meaningFailure) return new Response('', { status: 503 });
        const explanations = {
          initial: `${input.selectedText} 是用于打招呼的表达。见面或开始交谈时使用，语气通常友好。`,
          deeper: '它属于开启对话的寒暄语，作用是确认双方开始交流。语调和场景会影响它的礼貌程度。',
          simpler: '就像见到朋友时说“你好”，用它告诉对方：我在和你打招呼。',
          context: '按你的例子理解：就像打开一扇门，这个词用来开始一段交流。',
        };
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translation: input.selectedText === 'World' ? '世界' : '你好',
                    explanation: explanations[input.direction],
                  }),
                },
              },
            ],
          }),
        );
      }
      if (url.includes('chat/completions') || url.includes('chatcompletion_v2'))
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: '1. Hello, friend.\n2. She said hello.\n3. Say hello to Joe.' },
              },
            ],
          }),
        );
      return new Response('', { status: 503 });
    };
  });
  await harness.evaluate(() => chrome.runtime.sendMessage({ action: 'getBrowserVoices' }));
}
async function extensionPage(name) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/${name}/${name}.html`);
  return page;
}
async function readingPage() {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.bringToFront();
  return page;
}
async function select(page, selector = '#first') {
  await page.locator(selector).evaluate((el) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}
async function savedWords() {
  return harness.evaluate(
    async () =>
      (await (await import(chrome.runtime.getURL('lib/db.js'))).default.exportData()).words,
  );
}
async function seed(words) {
  return harness.evaluate(
    async (words) =>
      (await import(chrome.runtime.getURL('lib/db.js'))).default.importData({ words }),
    words,
  );
}
async function setSettings(patch) {
  return harness.evaluate(async (patch) => {
    const module = await import(chrome.runtime.getURL('lib/settings.js'));
    const settings = await module.getSettings();
    await module.saveSettings({
      ...settings,
      ...patch,
      providers: { ...settings.providers, ...patch.providers },
    });
  }, patch);
}
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; media-src 'none'; script-src 'self'; style-src 'self'; frame-src 'self'",
    );
    res.end(req.url === '/frame' ? '<!doctype html><p id="frameword">Frameword</p>' : fixture);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(path.join(process.cwd(), '.test-profile-'));
  // Match the public package: never import a developer's private credentials in tests.
  extensionRoot = await mkdtemp(path.join(process.cwd(), '.test-profile-extension-'));
  for (const entry of [
    'manifest.json',
    'assets',
    'background',
    'content',
    'lib',
    'offscreen',
    'options',
    'popup',
    'sidepanel',
  ])
    await cp(entry, path.join(extensionRoot, entry), { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  harness = await extensionPage('options');
  await harness.evaluate(async () => {
    await (await import(chrome.runtime.getURL('lib/settings.js'))).getSettings();
  });
});
test.beforeEach(async () => {
  errors.length = 0;
  await harness.evaluate(async () => {
    const db = (await import(chrome.runtime.getURL('lib/db.js'))).default;
    const connection = await db.open();
    await new Promise((resolve, reject) => {
      const tx = connection.transaction(
        ['words', 'contexts', 'lookup_cache', 'audio_cache'],
        'readwrite',
      );
      for (const store of ['words', 'contexts', 'lookup_cache', 'audio_cache'])
        tx.objectStore(store).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    const settings = await import(chrome.runtime.getURL('lib/settings.js'));
    await settings.saveSettings(settings.DEFAULTS);
    await chrome.storage.session.clear();
  });
  await prepareWorker();
});
test.afterEach(async () => {
  for (const page of context.pages()) if (page !== harness) await page.close();
  expect(errors).toEqual([]);
});
test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => server?.close(resolve));
  if (profile) await rm(profile, { recursive: true, force: true });
  if (extensionRoot) await rm(extensionRoot, { recursive: true, force: true });
});

test('selection returns translation and explanation together, with progress and contextual refinements', async () => {
  await setSettings({ providers: { dashscope: { apiKey: 'explanation-test-key' } } });
  await worker.evaluate(() => {
    globalThis.__meaningDelay = 700;
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.getByRole('progressbar')).toBeVisible();
  await expect(popup.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await expect(popup.locator('.status')).toContainText('Samantha');
  await expect(popup.locator('.translation')).toHaveText('你好');
  await expect(popup.locator('.explanation')).toContainText('Hello');
  await expect(popup.getByRole('progressbar')).toBeHidden();
  const first = await popup.locator('.explanation').innerText();
  await popup.locator('.add-context').click();
  await popup.locator('.context-note').fill('用生活中的例子解释');
  await page.keyboard.type('s');
  expect((await savedWords())[0].frequency).toBe(1);
  await popup.locator('.deeper').click();
  await expect(popup.locator('.context-form')).toBeHidden();
  await expect(popup.locator('.context-note')).toHaveValue('');
  await expect(popup.locator('.add-context')).toHaveAttribute('aria-expanded', 'false');
  await expect(popup.locator('.simpler')).toBeDisabled();
  await expect(popup.locator('.explanation')).toHaveText(first);
  await expect(popup.locator('.explanation')).toContainText('寒暄语');
  const requests = await worker.evaluate(() => __meaningRequests);
  expect(requests[1].input.direction).toBe('deeper');
  expect(requests[1].input.note).toBe('用生活中的例子解释s');
  expect(requests[1].input.previousExplanations.at(-1).explanation).toBe(first);
  await popup.locator('.simpler').click();
  await expect(popup.locator('.explanation')).toContainText('就像见到朋友');
  expect(await worker.evaluate(() => __meaningRequests.at(-1).input.note)).toBe('');
  expect(
    await worker.evaluate(() => __meaningRequests.at(-1).input.previousExplanations.at(-1).note),
  ).toBe('用生活中的例子解释s');
  await popup.locator('.add-context').click();
  await popup.locator('.context-note').fill('用开门作比喻');
  await popup.locator('.context-note').press('Control+Enter');
  await expect(popup.locator('.context-form')).toBeHidden();
  await expect(popup.locator('.explanation')).toBeFocused();
  await expect(popup.locator('.explanation')).toContainText('打开一扇门');
  expect([...(await popup.locator('.explanation').innerText())].length).toBeLessThanOrEqual(140);
  expect(
    await worker.evaluate(() => __meaningRequests.at(-1).input.previousExplanations.length),
  ).toBe(3);
  await popup.locator('.add-context').click();
  await expect(popup.locator('.context-note')).toHaveValue('');
  await popup.locator('.context-note').fill('再举一个例子');
  await popup.locator('.submit-context').click();
  await expect(popup.locator('.context-form')).toBeHidden();
  await expect(popup.getByRole('progressbar')).toBeVisible();
  await expect(popup.getByRole('progressbar')).toBeHidden();
  expect(await worker.evaluate(() => __meaningRequests.at(-1).input.note)).toBe('再举一个例子');
  await expect(popup.locator('.context-form')).toBeHidden();
  expect((await savedWords())[0].frequency).toBe(1);
  expect(await worker.evaluate(() => __calls.length)).toBe(1);
  expect(await popup.textContent()).not.toContain('explanation-test-key');
});

test('failed refinements preserve the previous explanation and note, then retry successfully', async () => {
  await setSettings({ providers: { dashscope: { apiKey: 'test-key' } } });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.locator('.explanation')).toBeVisible();
  const previous = await popup.locator('.explanation').innerText();
  await popup.locator('.add-context').click();
  await popup.locator('.context-note').fill('给一个例子');
  await worker.evaluate(() => {
    globalThis.__meaningFailure = true;
  });
  await popup.locator('.simpler').click();
  await expect(popup.locator('.explanation-error')).toContainText('暂不可用');
  await expect(popup.locator('.explanation')).toHaveText(previous);
  await expect(popup.locator('.context-form')).toBeVisible();
  await expect(popup.locator('.context-note')).toHaveValue('给一个例子');
  await expect(popup.getByRole('progressbar')).toBeHidden();
  await worker.evaluate(() => {
    globalThis.__meaningFailure = false;
  });
  await popup.locator('.retry-explanation').click();
  await expect(popup.locator('.explanation')).toContainText('就像见到朋友');
  await expect(popup.locator('.explanation-error')).toBeHidden();
  await expect(popup.locator('.context-form')).toBeHidden();
  await expect(popup.locator('.context-note')).toHaveValue('');
  expect(await worker.evaluate(() => __meaningRequests.at(-1).input.direction)).toBe('simpler');
});

test('missing AI setup keeps translation usable and can recover from the same popup', async () => {
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.locator('.translation')).toHaveText('你好。欢迎。');
  await expect(popup.locator('.explanation-error')).toContainText('配置 AI');
  await expect(popup.getByRole('progressbar')).toBeHidden();
  const opened = context.waitForEvent('page');
  await popup.locator('.configure-ai').click();
  const settingsPage = await opened;
  await expect(settingsPage).toHaveURL(/options.html#services/);
  await setSettings({ providers: { dashscope: { apiKey: 'test-key' } } });
  await page.bringToFront();
  await popup.locator('.retry-explanation').click();
  await expect(popup.locator('.translation')).toHaveText('你好');
  await expect(popup.locator('.explanation')).toContainText('Hello');
  await expect(popup.locator('.explanation-error')).toBeHidden();
  expect((await savedWords())[0].frequency).toBe(1);
});

test('new selections cancel old AI work; closing by button, Escape or page scroll stops speech', async () => {
  await setSettings({ providers: { dashscope: { apiKey: 'test-key' } } });
  await worker.evaluate(() => {
    globalThis.__meaningDelay = { Hello: 5000, World: 10 };
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  await expect.poll(() => worker.evaluate(() => __meaningRequests.length)).toBe(1);
  await select(page, '#second');
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.locator('.translation')).toHaveText('世界');
  await expect(popup.locator('.explanation')).toContainText('World');
  await expect.poll(() => worker.evaluate(() => __meaningAborted)).toBe(1);
  await popup.locator('.close').click();
  for (const close of ['button', 'escape', 'scroll']) {
    await select(page);
    await page.keyboard.press('s');
    await expect(popup.locator('.status')).toContainText('Samantha');
    await expect(popup.getByRole('progressbar')).toBeVisible();
    const stops = await worker.evaluate(() => __stops);
    const aborted = await worker.evaluate(() => __meaningAborted);
    if (close === 'button') await popup.locator('.close').click();
    if (close === 'escape') await page.keyboard.press('Escape');
    if (close === 'scroll') await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await expect(popup).toHaveCount(0);
    await expect.poll(() => worker.evaluate(() => __stops)).toBeGreaterThan(stops);
    await expect.poll(() => worker.evaluate(() => __meaningAborted)).toBeGreaterThan(aborted);
    await page.waitForTimeout(200);
  }
});

for (const colorScheme of ['light', 'dark']) {
  test(`AI explanation card fits narrow screens and is accessible in ${colorScheme}`, async () => {
    await setSettings({ providers: { dashscope: { apiKey: 'test-key' } } });
    const page = await readingPage();
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 420, height: 760 });
    await page.clock.install();
    await select(page);
    await page.keyboard.press('s');
    const popup = page.locator('wordvoice-popup');
    await expect(popup.locator('.explanation')).toBeVisible();
    await page.clock.fastForward(15000);
    await expect(popup).toBeVisible();
    await popup.screenshot({ path: `test-results/design-explanation-${colorScheme}.png` });
    await popup.locator('.add-context').click();
    await popup.locator('.context-note').fill('我第一次接触这个词，请举个例子');
    await page.setViewportSize({ width: 320, height: 600 });
    await expect
      .poll(async () => {
        const box = await popup.boundingBox();
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(589);
    const box = await popup.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(11);
    expect(box.x + box.width).toBeLessThanOrEqual(309);
    expect(box.y + box.height).toBeLessThanOrEqual(589);
    expect(await popup.locator('.card').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const result = await new AxeBuilder({ page })
      .include('wordvoice-popup')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
    await popup.screenshot({ path: `test-results/design-explanation-narrow-${colorScheme}.png` });
  });
}

test('local HTML supports S, saving its source, and live speech settings', async () => {
  expect(await harness.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())).toBe(true);
  const file = path.join(profile, 'local reading.html');
  await writeFile(file, fixture.replace('<iframe src="/frame"></iframe>', ''));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const url = pathToFileURL(file).href;
  await page.goto(url);
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.locator('.translation')).toHaveText('你好。欢迎。');
  await expect(popup.locator('.status')).toContainText('Samantha');
  await expect.poll(async () => (await savedWords()).length).toBe(1);
  const data = await harness.evaluate(async () =>
    (await import(chrome.runtime.getURL('lib/db.js'))).default.exportData(),
  );
  expect(data.contexts[0].pageUrl).toBe(url);
  expect(data.contexts[0].pageTitle).toBe('WordVoice test page');
  await setSettings({ providers: { minimax: { apiKey: 'file-test-key' } } });
  await expect(popup.locator('option[value="minimax"]')).toBeEnabled();
  expect(await popup.textContent()).not.toContain('file-test-key');
  await page.screenshot({ path: 'test-results/design-local-file.png' });
});

test('blocked Google translation falls back to the speech DashScope key before dictionary returns', async () => {
  await setSettings({ providers: { dashscope: { apiKey: 'shared-dashscope-test-key' } } });
  await worker.evaluate(() => {
    const original = fetch;
    globalThis.__qwenCalls = 0;
    globalThis.fetch = async (input, options = {}) => {
      const url = String(input);
      if (url.includes('google')) throw new TypeError('Failed to fetch');
      if (url.includes('dictionaryapi.dev'))
        await new Promise((resolve) => {
          globalThis.__releaseDictionary = resolve;
        });
      if (url.includes('dashscope.aliyuncs.com')) {
        globalThis.__qwenCalls++;
        if (options.headers.Authorization !== 'Bearer shared-dashscope-test-key')
          return new Response('', { status: 401 });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    translation: '你好',
                    explanation: '见面时使用的问候语，常用于开始一段交流。',
                  }),
                },
              },
            ],
          }),
        );
      }
      return original(input, options);
    };
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.locator('.translation')).toHaveText('你好');
  await expect(popup.locator('.status')).toContainText('Samantha');
  await expect(popup.locator('.error')).toBeHidden();
  expect(await worker.evaluate(() => typeof __releaseDictionary)).toBe('function');
  await worker.evaluate(() => __releaseDictionary());
  await expect.poll(async () => (await savedWords())[0]?.translation).toBe('你好');
  await expect.poll(async () => (await savedWords())[0]?.frequency).toBe(1);
  expect(await popup.textContent()).not.toContain('shared-dashscope-test-key');
  await page.screenshot({ path: 'test-results/design-translation-fallback.png' });
});

test('local file access help refreshes when Chrome access changes', async () => {
  const options = await extensionPage('options');
  await expect(options.locator('#fileAccessStatus')).toContainText('已允许');
  await options.evaluate(() => {
    chrome.extension.isAllowedFileSchemeAccess = async () => false;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(options.locator('#fileAccessStatus')).toContainText('允许访问文件网址');
  await options.evaluate(() => {
    chrome.extension.isAllowedFileSchemeAccess = async () => true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(options.locator('#fileAccessStatus')).toContainText('已允许');
});

test('S starts speech before slow lookups, preserves page DOM and saves once per keypress', async () => {
  await worker.evaluate(() => {
    globalThis.__delay = 1200;
  });
  const page = await readingPage();
  const before = await page.locator('#cross').innerHTML();
  await select(page, '#cross');
  const start = Date.now();
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup')).toBeVisible();
  const selectedBox = await page.locator('#cross').boundingBox();
  const popupBox = await page.locator('wordvoice-popup').boundingBox();
  expect(Math.abs(popupBox.y - (selectedBox.y + selectedBox.height + 10))).toBeLessThan(2);
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(1);
  const calls = await worker.evaluate(() => __calls);
  expect(calls[0].time - start).toBeLessThan(900);
  console.log(
    `Selection-to-TTS dispatch: ${calls[0].time - start} ms (lookup delay: 1200 ms; speech engine mocked).`,
  );
  expect(calls[0].text).toBe('Good morning, everyone.');
  await expect(page.locator('wordvoice-popup .translation')).toHaveText('你好。欢迎。');
  expect(await page.locator('#cross').innerHTML()).toBe(before);
  expect((await savedWords())[0].frequency).toBe(1);
  await page.keyboard.down('s');
  await page.keyboard.down('s');
  await page.keyboard.up('s');
  await expect.poll(async () => (await savedWords())[0].frequency).toBe(2);
});

test('typing, modifiers, IME, password and shadow DOM inputs preserve normal input', async () => {
  const page = await readingPage();
  await select(page);
  await page.locator('#input').focus();
  await page.keyboard.press('s');
  await page.locator('#editable').focus();
  await page.keyboard.press('s');
  await page.locator('#shadow').evaluate((el) => {
    const root = el.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    root.appendChild(input);
    input.focus();
  });
  await page.keyboard.press('s');
  await page.evaluate(() => document.querySelector('#shadow').shadowRoot.activeElement.blur());
  await select(page);
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Shift+s');
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', isComposing: true, bubbles: true }),
    ),
  );
  expect(await worker.evaluate(() => __calls.length)).toBe(0);
  expect(await savedWords()).toHaveLength(0);
});

test('focused iframe selection speaks once and renders only in the originating frame', async () => {
  const page = await readingPage();
  const frame = page.frames().find((f) => f.url().endsWith('/frame'));
  await frame.locator('#frameword').click();
  await select(frame, '#frameword');
  await frame.locator('body').evaluate((el) => el.focus());
  await page.keyboard.press('s');
  await expect(frame.locator('wordvoice-popup')).toBeVisible();
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(1);
  await expect(page.locator('wordvoice-popup')).toHaveCount(0);
});

test('new selection wins, replay works, stop and Escape dismiss', async () => {
  await worker.evaluate(() => {
    globalThis.__delay = 500;
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(1);
  await page.waitForTimeout(190);
  await select(page, '#second');
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup strong')).toHaveText('World');
  await expect(page.locator('wordvoice-popup .translation')).toHaveText('你好。欢迎。');
  await page.locator('wordvoice-popup .replay').click();
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(3);
  await page.locator('wordvoice-popup .stop').click();
  await expect(page.locator('wordvoice-popup .status')).toContainText('已停止');
  await page.keyboard.press('Escape');
  await expect(page.locator('wordvoice-popup')).toHaveCount(0);
});

test('offline lookups still speak and save, oversized selections show a clear error', async () => {
  await worker.evaluate(() => {
    globalThis.__offline = true;
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup .error')).toContainText('翻译暂不可用');
  await expect.poll(async () => (await savedWords()).length).toBe(1);
  expect(await worker.evaluate(() => __calls.length)).toBe(1);
  await page.locator('#second').evaluate((el) => {
    el.textContent = 'a'.repeat(2001);
  });
  await select(page, '#second');
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup .error')).toContainText('2000');
  expect((await savedWords()).length).toBe(1);
});

test('popup searches translations, plays, stops and opens settings', async () => {
  await seed([{ word: 'Hello', translation: '你好', frequency: 3 }]);
  const popup = await extensionPage('popup');
  await expect(popup.locator('.word-item')).toHaveCount(1);
  await popup.locator('#searchInput').fill('你好');
  await expect(popup.locator('.word-item')).toHaveCount(1);
  await popup.locator('.btn-play').click();
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(1);
  await popup.locator('#stopSpeech').click();
  await popup.locator('#searchInput').fill('missing');
  await expect(popup.locator('#wordList')).toContainText('没有匹配结果');
  await popup.locator('#openSettings').click();
  await expect
    .poll(() => context.pages().filter((p) => p.url().includes('/options/')).length)
    .toBeGreaterThan(0);
});

test('vocabulary filters, details, translation, AI, stats and review controls', async () => {
  await seed([
    { word: 'Hello', translation: '你好', frequency: 3 },
    { word: 'New York', translation: '纽约' },
    { word: 'This is a full sentence.' },
  ]);
  await setSettings({ providers: { qwen: { apiKey: 'test-only', textModel: 'test' } } });
  const panel = await extensionPage('sidepanel');
  await expect(panel.locator('.word-card')).toHaveCount(3);
  await panel.locator('#typeFilter').selectOption('sentence');
  await expect(panel.locator('.word-card')).toHaveCount(1);
  await panel.locator('#typeFilter').selectOption('all');
  await panel.locator('#searchInput').fill('纽约');
  await expect(panel.locator('.word-card')).toHaveCount(1);
  await panel.locator('#sortSelect').selectOption('word');
  await expect(panel.locator('.word-card')).toHaveCount(1);
  await panel.locator('.word-card').click();
  await expect(panel.locator('#detailWord')).toHaveText('New York');
  await expect(panel.locator('#detailTranslation')).toHaveText('纽约');
  await panel.locator('#detailPlayBtn').click();
  await panel.locator('#refreshTranslation').click();
  await expect(panel.locator('#detailTranslation')).toHaveText('你好。欢迎。');
  await panel.locator('#generateSentencesBtn').click();
  await expect(panel.locator('.ai-sentence-item')).toHaveCount(3);
  await panel.locator('.ai-sentence-item button').first().click();
  await panel.locator('#backBtn').click();
  await panel.locator('#statsViewBtn').click();
  await expect(panel.locator('#overviewTotal')).toHaveText('3');
  await panel.locator('.clickable-stat[data-filter="all"]').click();
  await expect(panel.locator('.word-card')).toHaveCount(3);
  await panel.locator('#reviewModeBtn').click();
  await expect(panel.locator('#reviewProgressText')).toHaveText('1/2');
  await panel.locator('#flashcard').click();
  await expect(panel.locator('#flashcard')).toHaveClass(/flipped/);
  await panel.locator('#btnKnow').click();
  await expect(panel.locator('#reviewProgressText')).toHaveText('2/2');
  await panel.locator('#btnLearning').click();
  await expect(panel.locator('#reviewSummary')).toBeVisible();
  await expect(panel.locator('#summaryKnow')).toHaveText('1');
  await expect(panel.locator('#summaryLearning')).toHaveText('1');
  await panel.locator('#btnRestartReview').click();
  await expect(panel.locator('#reviewProgressText')).toHaveText('1/2');
  await panel.locator('#btnUnknown').click();
  await panel.locator('#backToListBtn').click();
  await panel.locator('.filter-tab[data-filter="learning"]').click();
  await expect(panel.locator('.word-card')).toHaveCount(0);
});

test('import, export, malicious content and deletion work through UI', async () => {
  const panel = await extensionPage('sidepanel');
  const backup = {
    words: [{ id: 4, word: 'quoted " phrase', translation: '<img src=x onerror=alert(1)>' }],
    contexts: [{ wordId: 4, sentence: 'Example sentence', pageUrl: 'javascript:alert(1)' }],
  };
  const chooseFile = panel.waitForEvent('filechooser');
  await panel.locator('#toolsMenu summary').click();
  await panel.locator('#importBtn').click();
  await (
    await chooseFile
  ).setFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(panel.locator('.word-card')).toHaveCount(1);
  await expect(panel.locator('.word-card img')).toHaveCount(0);
  await panel.locator('.word-card .btn-play-small').click();
  await expect.poll(() => worker.evaluate(() => __calls[0]?.text)).toBe('quoted " phrase');
  const downloaded = panel.waitForEvent('download');
  await panel.locator('#toolsMenu summary').click();
  await panel.locator('#exportBtn').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/wordvoice-.*\.json/);
  await panel.locator('.word-card').click();
  await expect(panel.locator('#detailContexts a')).toHaveCount(0);
  await panel.locator('#deleteBtn').click();
  await expect(panel.locator('#deleteDialog')).toBeVisible();
  await panel.locator('#confirmDelete').click();
  await expect(panel.locator('.word-card')).toHaveCount(0);
  await panel
    .locator('#importFile')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(panel.locator('#pageStatus')).toContainText('导入失败');
});

test('settings persist exact fields, clear keys, test services, log playback and clear cache', async () => {
  const options = await extensionPage('options');
  await expect(options.locator('#saveBtn')).toBeEnabled();
  await options.locator('#pronunciation').selectOption('uk');
  await options.locator('#speechRate').selectOption('0.85');
  await options.locator('#qwen-apiKey').fill('test-only');
  await options.locator('#saveBtn').click();
  await options.locator('#testTts').click();
  await expect(options.locator('#testLog')).toContainText('成功');
  expect(await worker.evaluate(() => __calls[0].lang)).toBe('en-GB');
  expect(await worker.evaluate(() => __calls[0].rate)).toBe(0.85);
  await options.locator('#testTranslation').click();
  await expect(options.locator('#testLog')).toContainText('你好。欢迎。');
  await options.locator('#testAi').click();
  await expect(options.locator('#testLog')).toContainText('Hello, friend.');
  await options.locator('#refreshLogBtn').click();
  await expect(options.locator('#ttsLogContainer')).toContainText('浏览器语音');
  await options.locator('#qwen-apiKey').fill('');
  await options.locator('#saveBtn').click();
  await options.reload();
  await expect(options.locator('#qwen-apiKey')).toHaveValue('');
  await options.locator('#testAi').click();
  await expect(options.locator('#testLog')).toContainText('API Key');
  await options.locator('#clearCacheBtn').click();
  await expect(options.locator('#pageStatus')).toContainText('音频缓存已清除');
  await options.screenshot({
    animations: 'disabled',
    path: 'test-results/options.png',
    fullPage: true,
  });
});

test('cloud failure falls back; offscreen audio plays independently of blocked page media', async () => {
  await setSettings({
    ttsProvider: 'minimax',
    providers: { minimax: { apiKey: 'test-only', model: 'speech-02-turbo', voiceId: 'test' } },
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup .status')).toContainText('浏览器语音');
  await expect(page.locator('wordvoice-popup .error')).toContainText('503');
  // A generated WAV exercises the real extension audio element without external credentials.
  const sampleRate = 8000,
    samples = 1600;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin((i / sampleRate) * 440 * Math.PI * 2) * 1000), 44 + i * 2);
  await worker.evaluate((hex) => {
    __cloudAudio = hex;
  }, wav.toString('hex'));
  await page.waitForTimeout(200);
  await select(page, '#second');
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup .status')).toContainText('MiniMax');
  expect(
    await worker.evaluate(
      async () =>
        (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length,
    ),
  ).toBe(1);
  const calls = await worker.evaluate(() => __calls.length);
  expect(calls).toBe(1);
  await page.locator('wordvoice-popup .speech-provider').selectOption('chrome-tts');
  await expect(page.locator('wordvoice-popup .status')).toContainText('Samantha');
  await page.locator('wordvoice-popup .speech-provider').selectOption('minimax');
  await expect(page.locator('wordvoice-popup .status')).toContainText('MiniMax');
  await expect(page.locator('wordvoice-popup .error')).toBeHidden();
  expect((await savedWords()).find((word) => word.word === 'world').frequency).toBe(1);
  await page.screenshot({ animations: 'disabled', path: 'test-results/selection.png' });
});

test('popup opens the side panel within its user gesture and displays pending detail', async () => {
  await seed([{ word: 'panel', translation: '面板' }]);
  const popup = await extensionPage('popup');
  await expect(popup.locator('.word-item')).toHaveCount(1);
  await popup.locator('.word-item').click();
  await expect
    .poll(async () =>
      harness.evaluate(
        async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length,
      ),
    )
    .toBe(1);
  await expect
    .poll(async () =>
      harness.evaluate(
        async () => (await chrome.storage.local.get('pendingWordDetail')).pendingWordDetail || null,
      ),
    )
    .toBe(null);
});

test('reinjecting content scripts is idempotent and browser-command selection supports input', async () => {
  const page = await readingPage();
  const tabId = await harness.evaluate(
    async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0].id,
    baseURL,
  );
  await harness.evaluate(async (tabId) => {
    for (let i = 0; i < 2; i++)
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content/content.js'],
      });
  }, tabId);
  await page.bringToFront();
  await select(page);
  await page.keyboard.press('s');
  await expect.poll(async () => (await savedWords())[0]?.frequency).toBe(1);
  await page.locator('#textarea').focus();
  await page.locator('#textarea').selectText();
  await harness.evaluate(
    async (tabId) => chrome.tabs.sendMessage(tabId, { action: 'getSelection' }),
    tabId,
  );
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(2);
  expect(await worker.evaluate(() => __calls[1].text)).toBe('hello world');
  await page.locator('#input').evaluate((el) => {
    el.type = 'password';
    el.focus();
    el.select();
  });
  await harness.evaluate(
    async (tabId) => chrome.tabs.sendMessage(tabId, { action: 'getSelection' }),
    tabId,
  );
  expect(await worker.evaluate(() => __calls.length)).toBe(2);
});

test('pagination and narrow panel layouts keep every record accessible', async () => {
  await seed(
    Array.from({ length: 105 }, (_, i) => ({
      word: `entry-${String(i).padStart(3, '0')}`,
      translation: `译文 ${i}`,
    })),
  );
  const panel = await extensionPage('sidepanel');
  await panel.setViewportSize({ width: 380, height: 820 });
  await expect(panel.locator('.word-card')).toHaveCount(100);
  await panel.locator('#loadMore').click();
  await expect(panel.locator('.word-card')).toHaveCount(105);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.locator('#wordList').evaluate((el) => {
    el.scrollTop = 0;
  });
  await panel.screenshot({ animations: 'disabled', path: 'test-results/vocabulary.png' });
  await panel.locator('.word-card').first().click();
  await panel.screenshot({ animations: 'disabled', path: 'test-results/detail.png' });
  await panel.locator('#backBtn').click();
  await panel.locator('#statsViewBtn').click();
  await panel.screenshot({ animations: 'disabled', path: 'test-results/stats.png' });
  await panel.locator('#backFromStatsBtn').click();
  await panel.locator('#reviewModeBtn').click();
  await panel.locator('#flashcard').click();
  await panel.screenshot({ animations: 'disabled', path: 'test-results/review.png' });
});

test('provider menus, credential visibility, language preferences and shortcut link work', async () => {
  const options = await extensionPage('options');
  await expect(options.locator('#saveBtn')).toBeEnabled();
  for (const value of ['free-dict', 'dashscope', 'doubao', 'minimax', 'chrome-tts'])
    await options.locator('#ttsProvider').selectOption(value);
  for (const value of ['qwen', 'doubao', 'minimax', 'google'])
    await options.locator('#translationProvider').selectOption(value);
  for (const value of ['doubao', 'minimax', 'qwen'])
    await options.locator('#aiProvider').selectOption(value);
  await options.locator('.toggle-btn[data-target="qwen-apiKey"]').click();
  await expect(options.locator('#qwen-apiKey')).toHaveAttribute('type', 'text');
  await options.locator('.toggle-btn[data-target="qwen-apiKey"]').click();
  await expect(options.locator('#qwen-apiKey')).toHaveAttribute('type', 'password');
  await options.locator('#sourceLanguage').selectOption('fr');
  await options.locator('#targetLanguage').selectOption('en');
  await options.locator('#showTranslation').uncheck();
  await options.locator('#saveBtn').click();
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(1);
  expect(await worker.evaluate(() => __calls[0].lang)).toBe('fr');
  expect(await worker.evaluate(() => __fetches.length)).toBe(0);
  const opened = context.waitForEvent('page');
  await options.locator('#openShortcuts').click();
  const shortcuts = await opened;
  await shortcuts.waitForLoadState();
  expect(shortcuts.url()).toBe('chrome://extensions/shortcuts');
});

test('stalled cloud requests are aborted and browser speech starts within the fallback budget', async () => {
  await setSettings({
    ttsProvider: 'minimax',
    showTranslation: false,
    providers: { minimax: { apiKey: 'test-only', model: 'speech-02-turbo', voiceId: 'test' } },
  });
  await worker.evaluate(() => {
    __delay = 8000;
  });
  const page = await readingPage();
  await select(page, '#sentence');
  const started = Date.now();
  await page.keyboard.press('s');
  await expect.poll(() => worker.evaluate(() => __calls.length), { timeout: 7000 }).toBe(1);
  expect(Date.now() - started).toBeLessThan(6500);
  await expect(page.locator('wordvoice-popup .status')).toContainText('浏览器语音');
  await expect(page.locator('wordvoice-popup .error')).toContainText('5 秒');
});

test('speech errors remain visible while vocabulary saving succeeds', async () => {
  await worker.evaluate(() => {
    chrome.tts.speak = (text, options) =>
      options.onEvent({ type: 'error', errorMessage: '测试语音引擎不可用' });
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup .error')).toContainText('语音引擎不可用');
  await expect(page.locator('wordvoice-popup .status')).toContainText('已保存');
  expect((await savedWords()).length).toBe(1);
});

test('browser voice preview, saved selection, logs and accent changes use the chosen voice', async () => {
  const options = await extensionPage('options');
  await expect(options.locator('#saveBtn')).toBeEnabled();
  await expect(options.locator('#browserVoice option').first()).toContainText('Samantha');
  await options.locator('#testTts').click();
  await expect(options.locator('#testLog')).toContainText('Samantha');
  expect(await worker.evaluate(() => __calls.at(-1).voice)).toBe('Samantha');
  await options.locator('#browserVoice').selectOption('Test English US');
  await options.locator('#testTts').click();
  await expect(options.locator('#testLog')).toContainText('Test English US');
  await options.locator('#saveBtn').click();
  await options.reload();
  await expect(options.locator('#browserVoice')).toHaveValue('Test English US');
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup .status')).toContainText('Test English US');
  await options.locator('#refreshLogBtn').click();
  await expect(options.locator('#ttsLogContainer')).toContainText('Test English US');
  await options.locator('#pronunciation').selectOption('uk');
  await expect(options.locator('#browserVoice')).toHaveValue('');
  await expect(options.locator('#browserVoice option').first()).toContainText('Test English UK');
  await options.locator('#saveBtn').click();
});

test('removed browser voices remain visible in settings and fall back when speaking', async () => {
  await setSettings({ browserVoice: 'Removed Voice' });
  const options = await extensionPage('options');
  await expect(options.locator('#saveBtn')).toBeEnabled();
  await expect(options.locator('#browserVoice')).toHaveValue('Removed Voice');
  await expect(options.locator('#browserVoiceHint')).toContainText('当前不可用');
  await options.locator('#testTts').click();
  await expect(options.locator('#testLog')).toContainText('Samantha');
  await worker.evaluate(() => {
    chrome.tts.getVoices = (callback) =>
      callback([
        { voiceName: 'Removed Voice', lang: 'en-US', remote: false, eventTypes: ['start'] },
      ]);
  });
  await options.locator('#refreshVoices').click();
  await expect(options.locator('#browserVoiceHint')).toContainText('自动模式');
  await options.locator('#testTts').click();
  await expect(options.locator('#testLog')).toContainText('Removed Voice');
});

const designWords = [
  {
    word: 'serendipity',
    phonetic: '/ˌser.ənˈdɪp.ə.ti/',
    translation: '不期而遇的美好；意外发现的幸运',
    frequency: 7,
    mastery: 'learning',
    definitions: [
      {
        partOfSpeech: 'noun',
        meaning:
          'The chance of finding something beautiful when you are looking for something else.',
        example: 'Our meeting was pure serendipity.',
      },
    ],
  },
  {
    word: 'resonance',
    phonetic: '/ˈrez.ən.əns/',
    translation: '共鸣；回响',
    frequency: 4,
    mastery: 'mastered',
  },
  {
    word: 'a silver lining',
    translation: '困境中令人欣慰的一面',
    frequency: 3,
    mastery: 'learning',
  },
  { word: 'ephemeral', phonetic: '/ɪˈfem.ər.əl/', translation: '短暂的；转瞬即逝的', frequency: 2 },
  {
    word: 'Stay curious. There is always more to discover.',
    translation: '保持好奇，总有更多值得发现。',
    frequency: 1,
  },
  {
    word: 'wonder',
    phonetic: '/ˈwʌn.dər/',
    translation: '惊奇；想知道',
    frequency: 5,
    mastery: 'mastered',
  },
];
async function accessible(page, label) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  if (result.violations.length)
    await page.screenshot({ path: 'test-results/accessibility-failure.png' });
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, message: n.failureSummary })),
    })),
    label,
  ).toEqual([]);
}
for (const colorScheme of ['light', 'dark']) {
  test(`design audit: all surfaces in ${colorScheme} mode`, async () => {
    test.setTimeout(90000);
    await seed(
      designWords.map((w, i) => ({
        ...w,
        createdAt: Date.now() - i * 86400000,
        lastAccessedAt: Date.now() - i * 3600000,
      })),
    );
    const panel = await extensionPage('sidepanel');
    await panel.setViewportSize({ width: 380, height: 850 });
    await panel.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(panel.locator('.word-card')).toHaveCount(6);
    const shot = async (name) =>
      panel.screenshot({
        path: `test-results/design-${name}-${colorScheme}.png`,
        animations: 'disabled',
      });
    await accessible(panel, 'collection');
    await shot('collection');
    await panel.locator('#toolsMenu summary').click();
    await accessible(panel, 'backup menu');
    await shot('menu');
    await panel.keyboard.press('Escape');
    await panel.locator('.word-open').first().click();
    await accessible(panel, 'detail');
    await shot('detail');
    await panel.locator('#deleteBtn').click();
    await accessible(panel, 'delete confirmation');
    await shot('delete');
    await panel.keyboard.press('Escape');
    await panel.locator('#backBtn').click();
    await expect(panel.locator('.word-open').first()).toBeFocused();
    await panel.locator('#reviewModeBtn').click();
    await accessible(panel, 'review front');
    await shot('review');
    await panel.keyboard.press('Space');
    await expect(panel.locator('#flashcard')).toHaveClass(/flipped/);
    await accessible(panel, 'review answer');
    await shot('answer');
    for (let i = 0; i < 5; i++) await panel.locator('#btnKnow').click();
    await expect(panel.locator('#reviewSummary')).toBeVisible();
    await accessible(panel, 'review summary');
    await shot('summary');
    await panel.locator('#statsViewBtn').click();
    await accessible(panel, 'statistics');
    await shot('stats');
    for (const width of [320, 600]) {
      await panel.setViewportSize({ width, height: 700 });
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    const popup = await extensionPage('popup');
    await popup.setViewportSize({ width: 360, height: 590 });
    await popup.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(popup.locator('.word-item')).toHaveCount(6);
    await accessible(popup, 'popup');
    await popup.screenshot({ path: `test-results/design-popup-${colorScheme}.png` });
    const options = await extensionPage('options');
    await options.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await options.setViewportSize({ width: 1280, height: 960 });
    await expect(options.locator('#saveBtn')).toBeEnabled();
    await accessible(options, 'settings desktop');
    await options.screenshot({
      path: `test-results/design-settings-${colorScheme}.png`,
      fullPage: true,
    });
    await options.setViewportSize({ width: 375, height: 812 });
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await accessible(options, 'settings narrow');
    await options.screenshot({ path: `test-results/design-settings-narrow-${colorScheme}.png` });
    const page = await readingPage();
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await select(page);
    await page.keyboard.press('s');
    await expect(page.locator('wordvoice-popup .translation')).toBeVisible();
    const result = await new AxeBuilder({ page })
      .include('wordvoice-popup')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
    await page
      .locator('wordvoice-popup')
      .screenshot({ path: `test-results/design-selection-${colorScheme}.png` });
  });
}

test('empty views, clear search, keyboard review and modal focus work', async () => {
  const panel = await extensionPage('sidepanel');
  await panel.setViewportSize({ width: 320, height: 640 });
  await expect(panel.locator('.empty-title')).toContainText('暂无记录');
  await panel.screenshot({ path: 'test-results/design-empty.png' });
  await panel.locator('#reviewModeBtn').click();
  await expect(panel.locator('#reviewEmpty')).toBeVisible();
  await accessible(panel, 'empty review');
  await panel.locator('#libraryViewBtn').click();
  await seed([{ word: 'hello', translation: '你好' }]);
  await panel.reload();
  await expect(panel.locator('.word-card')).toHaveCount(1);
  await panel.locator('#searchInput').fill('missing');
  await expect(panel.locator('.empty-title')).toHaveText('没有匹配的记录');
  await panel.locator('#clearSearch').click();
  await expect(panel.locator('.word-card')).toHaveCount(1);
  await expect(panel.locator('#searchInput')).toBeFocused();
  await panel.keyboard.press('Tab');
  await panel.keyboard.press('Tab');
  await panel.locator('.word-open').focus();
  await panel.keyboard.press('Enter');
  await expect(panel.locator('#backBtn')).toBeFocused();
  await panel.keyboard.press('Shift+Tab');
  await expect(panel.locator('#deleteBtn')).toBeFocused();
  await panel.keyboard.press('Escape');
  await expect(panel.locator('.word-open')).toBeFocused();
  await panel.locator('#reviewModeBtn').click();
  await expect(panel.locator('#cardFlipBtn')).toBeFocused();
  await panel.keyboard.press('Space');
  await expect(panel.locator('#flashcard')).toHaveClass(/flipped/);
  await panel.keyboard.press('1');
  await expect(panel.locator('#reviewSummary')).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('settings navigation, unsaved state and provider disclosure stay coherent', async () => {
  const options = await extensionPage('options');
  await expect(options.locator('#saveBtn')).toBeEnabled();
  await options.locator('#ttsProvider').selectOption('minimax');
  await expect(options.locator('.credential-section[data-provider="minimax"]')).toHaveAttribute(
    'open',
    '',
  );
  await expect(options.locator('#saveStatus')).toContainText('未保存');
  await options.locator('.settings-sidebar a[href="#services"]').click();
  await expect(options.locator('.settings-sidebar nav .active')).toHaveAttribute(
    'href',
    '#services',
  );
  await options.locator('#saveBtn').click();
  await expect(options.locator('#saveStatus')).toHaveText('已保存');
  await options.locator('.settings-sidebar a[href="#help"]').click();
  await expect(options.locator('#openShortcuts')).toBeInViewport();
  await options.locator('.settings-sidebar a[href="#reading"]').last().click();
  await options.locator('#ttsProvider').selectOption('chrome-tts');
  await options.locator('#testTts').click();
  await expect(options.locator('.voice-preview #testLog')).toContainText('成功');
  await options.locator('#testTranslation').click();
  await expect(options.locator('.test-area #testLog')).toContainText('成功');
  await options.locator('#saveBtn').click();
});

test('long text fits the collection and detail; keyboard focus holds the selection card open', async () => {
  const long = 'Extraordinarily'.repeat(100);
  await seed([{ word: long, translation: '长文本测试' }]);
  const panel = await extensionPage('sidepanel');
  await panel.setViewportSize({ width: 320, height: 640 });
  await expect(panel.locator('.word-card')).toHaveCount(1);
  expect((await panel.locator('.word-card').boundingBox()).height).toBeLessThan(200);
  await panel.locator('.word-open').click();
  expect((await panel.locator('.detail-header').boundingBox()).height).toBeLessThan(240);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(panel.locator('#detailTranslation')).toBeInViewport();
  const page = await readingPage();
  await page.clock.install();
  await page.locator('#first').evaluate((el, text) => {
    el.textContent = text;
  }, long);
  await select(page);
  await page.keyboard.press('s');
  await expect(page.locator('wordvoice-popup .translation')).toBeVisible();
  await page.locator('wordvoice-popup .replay').focus();
  await page.clock.fastForward(13000);
  await expect(page.locator('wordvoice-popup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('wordvoice-popup')).toHaveCount(0);
});

test('floating speech choices persist, replay without another lookup, and cancel stale speech', async () => {
  await setSettings({
    providers: { minimax: { apiKey: 'private-test-key', model: 'speech-02-turbo' } },
  });
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  const choice = popup.locator('.speech-provider');
  await expect(choice).toBeEnabled();
  await expect(choice.locator('option[value="dashscope"]')).toBeDisabled();
  await expect(choice.locator('option[value="minimax"]')).toBeEnabled();
  await expect(popup.locator('.status')).toContainText('Samantha');
  await expect.poll(async () => (await savedWords())[0]?.frequency).toBe(1);
  await popup.locator('.replay').click();
  await expect.poll(() => worker.evaluate(() => __calls.length)).toBe(2);
  expect((await savedWords())[0].frequency).toBe(1);
  const lookups = await worker.evaluate(
    () => __fetches.filter((url) => !url.includes('t2a_v2')).length,
  );
  await choice.selectOption('minimax');
  await expect(popup.locator('.error')).toContainText('503');
  await expect(popup.locator('.status')).toContainText('Samantha');
  await expect(choice).toHaveValue('minimax');
  expect(
    await harness.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings.ttsProvider,
    ),
  ).toBe('minimax');
  expect((await savedWords())[0].frequency).toBe(1);
  expect(
    await worker.evaluate(() => __fetches.filter((url) => !url.includes('t2a_v2')).length),
  ).toBe(lookups);
  expect(await popup.textContent()).not.toContain('private-test-key');
  await worker.evaluate(() => {
    __delay = 1800;
  });
  await popup.locator('.replay').click();
  await expect
    .poll(() => worker.evaluate(() => __fetches.filter((url) => url.includes('t2a_v2')).length))
    .toBe(2);
  await choice.selectOption('chrome-tts');
  await expect(popup.locator('.status')).toContainText('Samantha');
  await expect(popup.locator('.error')).toBeHidden();
  await expect(choice).toHaveValue('chrome-tts');
  await page.waitForTimeout(2000);
  await expect(popup.locator('.status')).not.toContainText('已停止');
  expect((await savedWords())[0].frequency).toBe(1);
  await select(page, '#second');
  await page.keyboard.press('s');
  await expect(choice).toHaveValue('chrome-tts');
  await expect(popup.locator('.status')).toContainText('Samantha');
});

test('floating configuration opens services and refreshes availability after saving', async () => {
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.locator('.speech-provider')).toBeEnabled();
  const opened = context.waitForEvent('page');
  await popup.locator('.configure').click();
  const options = await opened;
  await options.waitForURL('**/options/options.html#services');
  await expect(options.locator('#saveBtn')).toBeEnabled();
  await options.locator('[data-provider="minimax"] summary').click();
  await options.locator('#minimax-apiKey').fill('private-configured-key');
  await options.locator('#saveBtn').click();
  await expect(options.locator('#saveStatus')).toContainText('已保存');
  await page.bringToFront();
  await expect(popup.locator('option[value="minimax"]')).toBeEnabled();
  expect(await popup.textContent()).not.toContain('private-configured-key');
  const audit = await new AxeBuilder({ page })
    .include('wordvoice-popup')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
});

test('credential file import unlocks the open speech menu and keeps preferences and vocabulary', async () => {
  const page = await readingPage();
  await select(page);
  await page.keyboard.press('s');
  const popup = page.locator('wordvoice-popup');
  await expect(popup.locator('option[value="dashscope"]')).toBeDisabled();
  await expect(popup.locator('option[value="minimax"]')).toBeDisabled();
  const options = await extensionPage('options');
  await expect(options.locator('#importCredentials')).toBeEnabled();
  await options.locator('#speechRate').selectOption('0.85');
  await options.locator('#credentialFile').setInputFiles({
    name: 'settings.local.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema: 1,
        revision: 'test-file',
        providers: {
          dashscope: { apiKey: 'private-dashscope-test-key' },
          minimax: { apiKey: 'private-minimax-test-key' },
        },
      }),
    ),
  });
  await expect(options.locator('#credentialImportStatus')).toContainText(
    '已导入并保存：阿里云百炼、MiniMax',
  );
  await expect(options.locator('#saveStatus')).toHaveText('已保存');
  await expect(popup.locator('option[value="dashscope"]')).toBeEnabled();
  await expect(popup.locator('option[value="minimax"]')).toBeEnabled();
  await expect(popup.locator('option[value="doubao"]')).toBeDisabled();
  expect(await popup.textContent()).not.toContain('private-');
  expect((await savedWords())[0].frequency).toBe(1);
  await options.reload();
  await expect(options.locator('#speechRate')).toHaveValue('0.85');
  await expect(options.locator('#minimax-apiKey')).toHaveValue('private-minimax-test-key');
  await options.locator('#credentialFile').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"secret":"private-parse-error-key"'),
  });
  await expect(options.locator('#credentialImportStatus')).toContainText('配置文件格式无效');
  expect(await options.locator('#credentialImportStatus').textContent()).not.toContain(
    'private-parse',
  );
  await expect(options.locator('#minimax-apiKey')).toHaveValue('private-minimax-test-key');
  await options.locator('#credentialFile').setInputFiles({
    name: 'large.json',
    mimeType: 'application/json',
    buffer: Buffer.alloc(128 * 1024 + 1),
  });
  await expect(options.locator('#credentialImportStatus')).toContainText('128 KB');
});

test('S wakes a stopped service worker and retains data and settings', async () => {
  await setSettings({ showTranslation: false, pronunciation: 'uk' });
  await seed([{ word: 'retained', translation: '保留' }]);
  const page = await readingPage();
  const cdp = await context.newCDPSession(harness);
  let versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
    versions = event.versions;
  });
  await cdp.send('ServiceWorker.enable');
  await expect
    .poll(() => versions.find((v) => v.scriptURL === worker.url())?.versionId)
    .toBeTruthy();
  const versionId = versions.find((v) => v.scriptURL === worker.url()).versionId;
  await cdp.send('ServiceWorker.stopWorker', { versionId });
  await expect
    .poll(() => versions.find((v) => v.versionId === versionId)?.runningStatus)
    .toBe('stopped');
  await page.bringToFront();
  await select(page, '#sentence');
  await page.keyboard.press('s');
  await expect
    .poll(() => versions.find((v) => v.versionId === versionId)?.runningStatus)
    .toBe('running');
  await expect(page.locator('wordvoice-popup .status')).toContainText('已保存');
  await expect.poll(async () => (await savedWords()).length).toBe(2);
  expect(
    await harness.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings.pronunciation,
    ),
  ).toBe('uk');
  if (process.platform === 'darwin') {
    await expect
      .poll(async () =>
        harness.evaluate(
          async () => (await chrome.storage.session.get('ttsLog')).ttsLog?.length || 0,
        ),
      )
      .toBe(1);
    console.log(
      'Native macOS speech start:',
      await harness.evaluate(
        async () => (await chrome.storage.session.get('ttsLog')).ttsLog[0].elapsedMs,
      ),
      'ms',
    );
  }
  // The popup remains open across another worker suspension. Closing it must
  // recover playback ownership from session storage and still stop synthesis.
  await expect
    .poll(() =>
      harness.evaluate(
        async () =>
          (await chrome.storage.session.get('selectionSpeechOwner')).selectionSpeechOwner
            ?.requestId,
      ),
    )
    .toBeTruthy();
  await cdp.send('ServiceWorker.stopWorker', { versionId });
  await expect
    .poll(() => versions.find((v) => v.versionId === versionId)?.runningStatus)
    .toBe('stopped');
  await page.locator('wordvoice-popup .close').click();
  await expect
    .poll(() =>
      harness.evaluate(
        async () => (await chrome.storage.session.get('selectionSpeechOwner')).selectionSpeechOwner,
      ),
    )
    .toBeNull();
  await expect
    .poll(() => harness.evaluate(() => new Promise((resolve) => chrome.tts.isSpeaking(resolve))))
    .toBe(false);
  await cdp.detach();
});
