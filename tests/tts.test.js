import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DEFAULTS } from '../lib/settings.js';
let storage, speech, played, offscreen, onEvent;
const area = () => ({
  get: async (key) => ({ [key]: storage[key] }),
  set: async (patch) => Object.assign(storage, patch),
  remove: async (key) => {
    delete storage[key];
  },
});
globalThis.chrome = {
  storage: { local: area(), session: area(), sync: area() },
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    getContexts: async () => (offscreen ? [{}] : []),
    sendMessage: async (message) => {
      if (message.action === 'play') played.push(message);
      return { success: true };
    },
  },
  offscreen: {
    createDocument: async () => {
      offscreen = true;
    },
  },
  tts: {
    stop: () => {
      onEvent?.({ type: 'interrupted' });
    },
    getVoices: (callback) =>
      callback([{ voiceName: 'British', lang: 'en-GB', remote: false, eventTypes: ['start'] }]),
    speak: (text, options, callback) => {
      speech.push({ text, options });
      onEvent = options.onEvent;
      callback();
      queueMicrotask(() => options.onEvent({ type: 'start' }));
    },
  },
};
const tts = await import('../lib/tts.js');
const db = (await import('../lib/db.js')).default;
beforeEach(async () => {
  db.db?.close();
  db.db = null;
  globalThis.indexedDB = new IDBFactory();
  storage = { settings: structuredClone(DEFAULTS) };
  speech = [];
  played = [];
  offscreen = false;
  onEvent = null;
});
test('browser speech starts without any dictionary or translation request and honors locale', async () => {
  const original = fetch;
  globalThis.fetch = () => {
    throw new Error('unexpected network request');
  };
  try {
    storage.settings.pronunciation = 'uk';
    storage.settings.speechRate = 0.7;
    await tts.speak('I live in London.');
    assert.equal(speech.length, 1);
    assert.equal(speech[0].text, 'I live in London.');
    assert.equal(speech[0].options.lang, 'en-GB');
    assert.equal(speech[0].options.voiceName, 'British');
    assert.equal(speech[0].options.rate, 0.7);
  } finally {
    globalThis.fetch = original;
  }
});
test('new requests cancel older work before synthesis starts', async () => {
  const first = tts.speak('older').catch((error) => error);
  const second = tts.speak('newer');
  assert.equal((await first).name, 'AbortError');
  await second;
  assert.deepEqual(
    speech.map((call) => call.text),
    ['newer'],
  );
});
test('cache identity includes full text, model, voice and language', async () => {
  const settings = structuredClone(DEFAULTS);
  const config = { model: 'one', voice: 'a' };
  const prefix = 'a'.repeat(120);
  const a = await tts.audioCacheKey(`${prefix}A`, 'dashscope', config, settings);
  assert.notEqual(a, await tts.audioCacheKey(`${prefix}B`, 'dashscope', config, settings));
  assert.notEqual(
    a,
    await tts.audioCacheKey(`${prefix}A`, 'dashscope', { ...config, voice: 'b' }, settings),
  );
  assert.notEqual(
    a,
    await tts.audioCacheKey(`${prefix}A`, 'dashscope', { ...config, model: 'two' }, settings),
  );
  assert.notEqual(
    a,
    await tts.audioCacheKey(`${prefix}A`, 'dashscope', config, {
      ...settings,
      sourceLanguage: 'fr',
    }),
  );
});
test('failed cloud audio falls back and strict provider tests report the failure', async () => {
  const settings = structuredClone(DEFAULTS);
  settings.ttsProvider = 'minimax';
  settings.providers.minimax.apiKey = 'test-only';
  const original = fetch;
  globalThis.fetch = async () => new Response('', { status: 401 });
  try {
    const result = await tts.speak('hello', settings);
    assert.equal(result.ttsSource.provider, 'chrome-tts');
    assert.match(result.fallbackReason, /401/);
    await assert.rejects(tts.speak('hello', settings, { strict: true }), /401/);
  } finally {
    globalThis.fetch = original;
  }
});
test('cloud audio uses extension playback, reuses cache and new voice generates new audio', async () => {
  const settings = structuredClone(DEFAULTS);
  settings.ttsProvider = 'minimax';
  settings.providers.minimax.apiKey = 'test-only';
  const original = fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(
      JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: '012345ab' } }),
    );
  };
  try {
    await tts.speak('Hello world', settings);
    await tts.speak('Hello world', settings);
    assert.equal(requests, 1);
    assert.equal(played.length, 2);
    assert.equal(speech.length, 0);
    settings.providers.minimax.voiceId = 'another';
    await tts.speak('Hello world', settings);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = original;
  }
});
