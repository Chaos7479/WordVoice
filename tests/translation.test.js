import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { normalizeSettings, textServiceConfig } from '../lib/settings.js';
import { translateWithSettings } from '../lib/translate.js';

globalThis.indexedDB = new IDBFactory();
const response = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

test('Qwen reuses a speech key while respecting a separately configured text key', () => {
  const settings = normalizeSettings({ providers: { dashscope: { apiKey: 'speech-key' } } });
  assert.equal(textServiceConfig(settings, 'qwen').apiKey, 'speech-key');
  assert.equal(settings.providers.qwen.apiKey, '');
  settings.providers.qwen.apiKey = 'text-key';
  assert.equal(textServiceConfig(settings, 'qwen').apiKey, 'text-key');
  assert.equal(textServiceConfig(settings, 'minimax').apiKey, '');
});

test('Google failure uses a configured service and caches only that service result', async () => {
  const settings = normalizeSettings({ providers: { dashscope: { apiKey: 'private-test-key' } } });
  const original = fetch;
  let googleWorking = false;
  let qwenCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (url.includes('google')) {
      assert.equal(options.headers, undefined);
      if (!googleWorking) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(['谷歌恢复后的译文']));
    }
    assert.equal(new URL(url).hostname, 'dashscope.aliyuncs.com');
    assert.equal(options.headers.Authorization, 'Bearer private-test-key');
    qwenCalls++;
    return response('百炼备用译文');
  };
  try {
    assert.equal(await translateWithSettings('fallback example', settings), '百炼备用译文');
    assert.equal(await translateWithSettings('fallback example', settings), '百炼备用译文');
    assert.equal(qwenCalls, 1);
    googleWorking = true;
    assert.equal(await translateWithSettings('fallback example', settings), '谷歌恢复后的译文');
  } finally {
    globalThis.fetch = original;
  }
});

test('unconfigured services are skipped and complete failures preserve diagnostic details', async () => {
  const settings = normalizeSettings({
    translationProvider: 'qwen',
    providers: { qwen: { apiKey: 'private-failed-key' } },
  });
  const original = fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url).hostname);
    return new Response('', { status: url.includes('dashscope') ? 401 : 429 });
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++)
      await assert.rejects(translateWithSettings('failed example', settings), (error) => {
        assert.match(error.message, /通义千问.*401/);
        assert.match(error.message, /Google.*429/);
        assert.doesNotMatch(error.message, /private-failed-key/);
        return true;
      });
    assert.deepEqual(calls, [
      'dashscope.aliyuncs.com',
      'clients5.google.com',
      'translate.googleapis.com',
      'dashscope.aliyuncs.com',
      'clients5.google.com',
      'translate.googleapis.com',
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test('same-language text and exhausted deadlines make no network requests', async () => {
  const original = fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('unexpected fetch');
  };
  try {
    const settings = normalizeSettings({ sourceLanguage: 'en', targetLanguage: 'en' });
    assert.equal(await translateWithSettings('Same language.', settings), 'Same language.');
    await assert.rejects(translateWithSettings('expired', settings, 0), /请求超时/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
