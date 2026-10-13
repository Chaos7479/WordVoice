import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  importLocalCredentials,
  mergeCredentialSettings,
  importCredentialData,
} from '../lib/settings.js';

test('private credentials import once, preserve preferences, and respect subsequent key removal', async () => {
  const storage = {
    settings: { ...structuredClone(DEFAULTS), speechRate: 0.85, browserVoice: 'Samantha' },
  };
  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    storage: {
      local: {
        get: async (key) => ({ [key]: structuredClone(storage[key]) }),
        set: async (patch) => Object.assign(storage, structuredClone(patch)),
      },
      sync: { remove: async () => {} },
    },
  };
  const original = fetch;
  let file = {
    schema: 1,
    revision: 'first-import',
    ttsProvider: 'minimax',
    providers: {
      minimax: { apiKey: 'test-only', unexpected: 'ignored' },
      unknown: { apiKey: 'ignored' },
    },
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, 'chrome-extension://test/settings.local.json');
    return new Response(JSON.stringify(file));
  };
  try {
    assert.equal(await importLocalCredentials(), true);
    assert.equal(storage.settings.providers.minimax.apiKey, 'test-only');
    assert.equal(storage.settings.providers.minimax.unexpected, undefined);
    assert.equal(storage.settings.providers.unknown, undefined);
    assert.equal(storage.settings.speechRate, 0.85);
    assert.equal(storage.settings.browserVoice, 'Samantha');
    assert.equal(storage.settings.ttsProvider, 'chrome-tts');
    storage.settings.providers.minimax.apiKey = '';
    assert.equal(await importLocalCredentials(), false);
    assert.equal(storage.settings.providers.minimax.apiKey, '');
    file.revision = 'rotated-key';
    assert.equal(await importLocalCredentials(), true);
    assert.equal(storage.settings.providers.minimax.apiKey, 'test-only');
    globalThis.fetch = async () => {
      throw new Error('file missing');
    };
    assert.equal(await importLocalCredentials(), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('manual credential import validates the whole file and preserves other settings', () => {
  const settings = structuredClone(DEFAULTS);
  settings.ttsProvider = 'free-dict';
  settings.speechRate = 0.85;
  settings.providers.minimax.apiKey = 'existing-key';
  const file = {
    schema: 1,
    revision: 'manual',
    providers: {
      dashscope: { apiKey: ' new-key ', model: '' },
      minimax: { apiKey: '' },
      unknown: { apiKey: 'ignored' },
    },
  };
  const result = mergeCredentialSettings(settings, file);
  assert.deepEqual(result.imported, ['dashscope']);
  assert.equal(result.settings.providers.dashscope.apiKey, 'new-key');
  assert.equal(result.settings.providers.dashscope.model, DEFAULTS.providers.dashscope.model);
  assert.equal(result.settings.providers.minimax.apiKey, 'existing-key');
  assert.equal(result.settings.ttsProvider, 'free-dict');
  assert.equal(result.settings.speechRate, 0.85);
  assert.equal(settings.providers.dashscope.apiKey, '');
  for (const invalid of [
    null,
    [],
    {},
    { ...file, schema: 2 },
    { ...file, revision: '' },
    { ...file, providers: [] },
    { ...file, providers: { unknown: { apiKey: 'ignored' } } },
    { ...file, providers: { dashscope: { accessToken: 'unsupported-field' } } },
    { ...file, providers: { minimax: { apiKey: 'secret', model: 42 } } },
  ])
    assert.throws(() => mergeCredentialSettings(settings, invalid));
});

test('explicit import restores a cleared key even when its revision was already imported', async () => {
  const storage = { settings: structuredClone(DEFAULTS), localCredentialsRevision: 'same-file' };
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (patch) => Object.assign(storage, patch),
      },
      sync: { remove: async () => {} },
    },
  };
  try {
    await importCredentialData({
      schema: 1,
      revision: 'same-file',
      providers: { minimax: { apiKey: 'restored-test-key' } },
    });
    assert.equal(storage.settings.providers.minimax.apiKey, 'restored-test-key');
    assert.equal(storage.localCredentialsRevision, 'same-file');
    const before = structuredClone(storage);
    await assert.rejects(
      importCredentialData({
        schema: 1,
        revision: 'bad',
        providers: { dashscope: { apiKey: 'valid' }, minimax: { apiKey: 'invalid', model: {} } },
      }),
    );
    assert.deepEqual(storage, before);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
