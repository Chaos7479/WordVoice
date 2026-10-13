import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DEFAULTS, speechOptions, chooseSpeechProvider } from '../lib/settings.js';
let storage, legacyStorage, speech, played, offscreen, onEvent;
const area = (legacy = false) => ({
  get: async (key) => ({ [key]: (legacy ? legacyStorage : storage)[key] }),
  set: async (patch) => Object.assign(legacy ? legacyStorage : storage, patch),
  remove: async (key) => {
    delete (legacy ? legacyStorage : storage)[key];
  },
});
globalThis.chrome = {
  storage: { local: area(), session: area(), sync: area(true) },
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
  legacyStorage = {};
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
    const result = await tts.speak('I live in London.');
    assert.equal(result.ttsSource.voice, 'British');
    assert.match(result.ttsSource.label, /British/);
    assert.match((await tts.getTtsLog())[0].source, /British/);
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
test('speech choices expose readiness without credentials and persist only the provider', async () => {
  storage.settings.providers.minimax.apiKey = 'private-minimax-value';
  storage.settings.providers.doubao.apiKey = 'text-key-is-not-a-speech-token';
  const options = speechOptions(storage.settings);
  assert.equal(options.providers.find((p) => p.id === 'minimax').configured, true);
  assert.equal(options.providers.find((p) => p.id === 'doubao').configured, false);
  assert.doesNotMatch(
    JSON.stringify(options),
    /private-minimax-value|text-key-is-not-a-speech-token|apiKey|accessToken/,
  );
  const before = structuredClone(storage.settings);
  await Promise.all([chooseSpeechProvider('minimax'), chooseSpeechProvider('chrome-tts')]);
  assert.deepEqual(storage.settings, before);
  await assert.rejects(chooseSpeechProvider('doubao'), /配置/);
  await assert.rejects(chooseSpeechProvider('__proto__'), /配置/);
  assert.deepEqual(storage.settings, before);
});
test('a replay waiting for preferences cannot interrupt a newer selection', async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const old = tts.speak('older replay', pending).catch((error) => error);
  await tts.speak('new selection');
  resolve(storage.settings);
  assert.equal((await old).name, 'AbortError');
  assert.deepEqual(
    speech.map((call) => call.text),
    ['new selection'],
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
test('Qwen signed OSS audio is downloaded over HTTPS without forwarding API credentials', async () => {
  const settings = structuredClone(DEFAULTS);
  settings.ttsProvider = 'dashscope';
  settings.providers.dashscope.apiKey = 'test-only';
  const original = fetch;
  let audioUrl =
    'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav?Signature=a%2Bb%3D&Expires=42';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return url.includes('/generation')
      ? new Response(JSON.stringify({ output: { audio: { url: audioUrl } } }))
      : new Response(new Uint8Array([1, 2, 3, 4]));
  };
  try {
    const result = await tts.speak('hello', settings, { strict: true });
    assert.equal(result.ttsSource.provider, 'dashscope');
    assert.equal(calls[1].url, audioUrl.replace('http:', 'https:'));
    assert.equal(calls[1].options.headers, undefined);
    assert.equal(played.length, 1);
    audioUrl = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.example/audio.wav';
    await assert.rejects(tts.speak('another', settings, { strict: true }), /未知地址/);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});
