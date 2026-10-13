import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { WordVoiceDB } from '../lib/db.js';
import { getTextType, normalizeText, safePageUrl, weekStart } from '../lib/text.js';
import { escapeHtml } from '../lib/ui.js';
import { normalizeSettings, getSettings, saveSettings } from '../lib/settings.js';
import { request } from '../lib/network.js';
import { translateDirect } from '../lib/translate.js';
let db;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  db = new WordVoiceDB();
});

test('normalization preserves sentence casing and bounds input', () => {
  assert.equal(normalizeText('  I\n love  New York. '), 'I love New York.');
  assert.equal(getTextType('hello'), 'word');
  assert.equal(getTextType('can’t'), 'word');
  assert.equal(getTextType('New York'), 'phrase');
  assert.equal(getTextType('Hello world!'), 'sentence');
  assert.throws(() => normalizeText('x'.repeat(2001)));
  assert.throws(() => normalizeText({}));
  assert.equal(safePageUrl('javascript:alert(1)'), '');
  assert.equal(escapeHtml('"<img onerror=1>'), '&quot;&lt;img onerror=1&gt;');
  assert.equal(new Date(weekStart(new Date(2026, 9, 12))).getDay(), 1);
});
test('concurrent saves are atomic, retain definitions and deduplicate contexts', async () => {
  const initial = await db.saveWord({
    word: 'Hello',
    translation: '你好',
    definitions: [{ meaning: 'a greeting' }],
  });
  await Promise.all(
    Array.from({ length: 25 }, () =>
      db.saveWord(
        { word: 'hello', definitions: [] },
        { sentence: 'Hello world', pageUrl: 'https://example.org' },
      ),
    ),
  );
  const word = await db.getWordWithContexts(initial.id);
  assert.equal(word.frequency, 26);
  assert.equal(word.translation, '你好');
  assert.equal(word.definitions[0].meaning, 'a greeting');
  assert.equal(word.contexts.length, 1);
  assert.equal((await db.getStats()).total, 1);
});
test('contexts are bounded and unsafe URLs are removed', async () => {
  let word;
  for (let i = 0; i < 28; i++)
    word = await db.saveWord(
      { word: 'bounded' },
      { sentence: `context ${i}`, pageUrl: 'javascript:alert(1)' },
    );
  const detail = await db.getWordWithContexts(word.id);
  assert.equal(detail.contexts.length, 20);
  assert(detail.contexts.every((c) => !c.pageUrl));
});
test('enrichment does not increase frequency or resurrect a deleted word', async () => {
  const w = await db.saveWord({ word: 'apple' });
  await db.enrichWord(w.id, { translation: '苹果' });
  assert.equal((await db.getWordWithContexts(w.id)).frequency, 1);
  await db.deleteWord(w.id);
  assert.equal(await db.enrichWord(w.id, { translation: '苹果' }), null);
});
test('backup roundtrip preserves translation, display casing, metadata, mastery and contexts', async () => {
  const w = await db.saveWord(
    { word: 'New York', translation: '纽约', translationLanguage: 'zh-CN' },
    { sentence: 'I live in New York.', pageUrl: 'https://example.org' },
  );
  await db.updateMastery(w.id, 'mastered');
  const backup = await db.exportData();
  await db.deleteWord(w.id);
  await db.importData(backup);
  const exported = await db.exportData();
  const row = exported.words[0];
  assert.equal(row.translation, '纽约');
  assert.equal(row.displayText, 'New York');
  assert.equal(row.mastery, 'mastered');
  assert.equal(row.createdAt, backup.words[0].createdAt);
  assert.equal(exported.contexts.length, 1);
  assert.equal(exported.contexts[0].wordId, row.id);
  await db.importData(backup);
  const again = await db.exportData();
  assert.equal(again.words.length, 1);
  assert.equal(again.words[0].frequency, 1);
  assert.equal(again.contexts.length, 1);
});
test('invalid import is validated before any writes and duplicate words merge', async () => {
  await assert.rejects(
    db.importData({
      words: [
        { id: 1, word: 'ok' },
        { id: 1, word: 'bad' },
      ],
    }),
  );
  assert.equal((await db.getStats()).total, 0);
  const result = await db.importData({
    words: [
      { id: 1, word: 'OK', frequency: 2 },
      { id: 2, word: 'ok', frequency: 8 },
    ],
  });
  assert.equal(result.imported, 1);
  assert.equal(result.merged, 1);
  assert.equal((await db.getWords())[0].frequency, 8);
});
test('import bounds contexts even when incoming contexts are older', async () => {
  const w = await db.saveWord({ word: 'contexts' });
  for (let i = 0; i < 20; i++) await db.saveWord({ word: w.word }, { sentence: `new ${i}` });
  await db.importData({
    words: [{ id: 99, word: w.word }],
    contexts: Array.from({ length: 20 }, (_, i) => ({
      wordId: 99,
      sentence: `old ${i}`,
      createdAt: 1000 + i,
    })),
  });
  assert.equal((await db.getWordWithContexts(w.id)).contexts.length, 20);
});
test('pagination, translation search and review filtering work past old limits', async () => {
  await db.importData({
    words: Array.from({ length: 1050 }, (_, i) => ({
      word: `word-${String(i).padStart(4, '0')}`,
      translation: i === 1049 ? '最后一个' : '',
    })),
  });
  const result = await db.queryWords({ query: '最后一个' });
  assert.equal(result.total, 1);
  assert.equal((await db.exportData()).words.length, 1050);
  const page = await db.queryWords({ offset: 1000, limit: 100 });
  assert.equal(page.words.length, 50);
  const sentences = Array.from({ length: 25 }, (_, i) => ({
    word: `This is a sentence number ${i}.`,
    frequency: 100,
  }));
  await db.importData({ words: sentences.concat({ word: 'actual', frequency: 50 }) });
  assert((await db.getWordsForReview(20)).some((w) => w.word === 'actual'));
});
test('v3 database upgrades without losing saved words', async () => {
  const legacy = await new Promise((resolve, reject) => {
    const req = indexedDB.open('WordVoiceDB', 3);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
      store.createIndex('word', 'word', { unique: true });
      store.add({ word: 'legacy', translation: '保留', frequency: 7 });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  legacy.close();
  const connection = await db.open();
  assert.equal(connection.version, 4);
  assert.equal((await db.exportData()).words[0].translation, '保留');
});
test('cache expires, caps entry count and clears separately from words', async () => {
  await db.saveWord({ word: 'keep' });
  await db.setCache('expired', { text: 'old' }, -1);
  assert.equal(await db.getCache('expired'), null);
  for (let i = 0; i < 205; i++) await db.saveAudioCache(`key-${i}`, 'YWJj');
  assert.equal((await db.getAudioCacheStats()).count, 200);
  await db.clearAudioCache();
  assert.equal((await db.getAudioCacheStats()).count, 0);
  assert.equal((await db.getStats()).total, 1);
});
test('settings defaults are fresh objects, explicit empty keys persist, v1 migration retains preferences', async () => {
  const local = {},
    sync = { settings: { pronunciation: 'uk', providers: { qwen: { apiKey: 'test-key' } } } };
  const area = (store) => ({
    get: async (key) => ({ [key]: store[key] }),
    set: async (patch) => Object.assign(store, patch),
    remove: async (key) => {
      delete store[key];
    },
  });
  globalThis.chrome = { storage: { local: area(local), sync: area(sync) } };
  const migrated = await getSettings();
  assert.equal(migrated.pronunciation, 'uk');
  assert.equal(migrated.providers.qwen.apiKey, 'test-key');
  assert.equal(sync.settings, undefined);
  migrated.providers.qwen.apiKey = '';
  await saveSettings(migrated);
  assert.equal((await getSettings()).providers.qwen.apiKey, '');
  const a = normalizeSettings();
  a.providers.qwen.apiKey = 'mutated';
  assert.equal(normalizeSettings().providers.qwen.apiKey, '');
  const legacy = normalizeSettings({
    providers: { dashscope: { model: 'cosyvoice-v2', voice: 'old' } },
  });
  assert.equal(legacy.providers.dashscope.model, 'qwen3-tts-flash');
});
test('Google translation joins every returned sentence and preserves request casing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).searchParams.get('q'), 'I live in New York. It is big.');
    return new Response(JSON.stringify([[['我住在纽约。'], ['它很大。']]]));
  };
  try {
    assert.equal(
      await translateDirect('I live in New York. It is big.', 'google', {}, 1000, 'en', 'zh-CN'),
      '我住在纽约。它很大。',
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('network deadlines abort the actual response body, HTTP errors surface', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_, options) => ({
    ok: true,
    json: () =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason)),
      ),
  });
  try {
    await assert.rejects(request('https://example.org', { timeoutMs: 20 }), /超时/);
  } finally {
    globalThis.fetch = original;
  }
  globalThis.fetch = async () => new Response('', { status: 401 });
  try {
    await assert.rejects(request('https://example.org'), /HTTP 401/);
  } finally {
    globalThis.fetch = original;
  }
});

test('Google browser endpoint works and falls back within one service on rate limiting', async () => {
  const original = globalThis.fetch;
  let requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response(JSON.stringify(['你好。欢迎。']));
  };
  try {
    assert.equal(
      await translateDirect('Hello. Welcome.', 'google', {}, 1000, 'en', 'zh-CN'),
      '你好。欢迎。',
    );
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = original;
  }
  requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return url.includes('clients5')
      ? new Response('', { status: 429 })
      : new Response(JSON.stringify([[['你好。'], ['欢迎。']]]));
  };
  try {
    assert.equal(
      await translateDirect('Hello. Welcome.', 'google', {}, 1000, 'en', 'zh-CN'),
      '你好。欢迎。',
    );
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});
