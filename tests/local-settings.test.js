import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, importLocalCredentials } from '../lib/settings.js';

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
