import { normalizeText, getTextType, safePageUrl, textField, weekStart } from './text.js';
const DB_NAME = 'WordVoiceDB';
const DB_VERSION = 4;
const CACHE_LIMIT = 1000;
const AUDIO_LIMIT = 200;
const AUDIO_BYTES = 32 * 1024 * 1024;
const MAX_CONTEXTS = 20;
const asPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const completed = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('数据保存已取消'));
    tx.onerror = () => reject(tx.error || new Error('数据保存失败'));
  });
const timestamp = (value) =>
  Number.isFinite(value) && value > 0 && value <= Date.now() + 86400000 ? value : Date.now();
const count = (value) => (Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1e9) : 1);
const mastery = (value) => (['new', 'learning', 'mastered'].includes(value) ? value : 'new');
function details(data) {
  return {
    phonetic: textField(data.phonetic, 300),
    translation: textField(data.translation, 10000),
    translationLanguage: textField(data.translationLanguage, 20),
    definitions: Array.isArray(data.definitions)
      ? data.definitions
          .slice(0, 20)
          .map((d) => ({
            meaning: textField(d?.meaning, 3000),
            partOfSpeech: textField(d?.partOfSpeech, 100),
            example: textField(d?.example, 3000),
          }))
          .filter((d) => d.meaning)
      : [],
    audioUrl: safePageUrl(data.audioUrl),
  };
}
function mergeDetails(existing, data) {
  const patch = details(data);
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, v]) => (Array.isArray(v) ? v.length : v)),
    ),
  };
}
function contextRecord(data, wordId) {
  return {
    wordId,
    sentence: textField(data.sentence),
    pageUrl: safePageUrl(data.pageUrl),
    pageTitle: textField(data.pageTitle, 500),
    aiSentence: textField(data.aiSentence),
    createdAt: timestamp(data.createdAt),
  };
}
function addContextInTransaction(tx, data, wordId) {
  if (!data || !(data.sentence || data.pageUrl)) return;
  const store = tx.objectStore('contexts');
  const context = contextRecord(data, wordId);
  const req = store.index('wordId').getAll(wordId);
  req.onsuccess = () => {
    const rows = req.result.sort((a, b) => a.createdAt - b.createdAt);
    const duplicate = rows.find(
      (c) => c.sentence === context.sentence && c.pageUrl === context.pageUrl,
    );
    if (duplicate) return;
    while (rows.length >= MAX_CONTEXTS) store.delete(rows.shift().id);
    store.add(context);
  };
}

export class WordVoiceDB {
  db = null;
  opening = null;
  async open() {
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('请关闭旧版单词本和设置页面，然后重试'));
      req.onupgradeneeded = () => {
        const db = req.result;
        const words = db.objectStoreNames.contains('words')
          ? req.transaction.objectStore('words')
          : db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        for (const key of ['word', 'frequency', 'createdAt', 'lastAccessedAt', 'mastery', 'type']) {
          if (!words.indexNames.contains(key))
            words.createIndex(key, key, { unique: key === 'word' });
        }
        if (!db.objectStoreNames.contains('contexts')) {
          const contexts = db.createObjectStore('contexts', { keyPath: 'id', autoIncrement: true });
          contexts.createIndex('wordId', 'wordId');
          contexts.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('audio_cache'))
          db.createObjectStore('audio_cache', { keyPath: 'cacheKey' });
        if (!db.objectStoreNames.contains('lookup_cache'))
          db.createObjectStore('lookup_cache', { keyPath: 'cacheKey' });
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
        this.db.onclose = () => {
          this.db = null;
        };
        resolve(this.db);
      };
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }
  getDB() {
    return this.open();
  }

  async saveWord(data, context) {
    const displayText = normalizeText(data.displayText || data.word);
    const word = displayText.toLowerCase(); // Retain the v1 unique index for data compatibility.
    const db = await this.open();
    const tx = db.transaction(['words', 'contexts'], 'readwrite');
    const done = completed(tx);
    const store = tx.objectStore('words');
    let result;
    const req = store.index('word').get(word);
    req.onsuccess = () => {
      const existing = req.result;
      const now = Date.now();
      const row = existing
        ? {
            ...mergeDetails(existing, data),
            displayText,
            frequency: count(existing.frequency) + 1,
            lastAccessedAt: now,
          }
        : {
            word,
            displayText,
            ...details(data),
            type: getTextType(displayText),
            frequency: 1,
            mastery: 'new',
            notes: '',
            tags: [],
            createdAt: now,
            lastAccessedAt: now,
          };
      const put = store.put(row);
      put.onsuccess = () => {
        result = { ...row, id: put.result, isNew: !existing };
        addContextInTransaction(tx, context, put.result);
      };
    };
    await done;
    return result;
  }

  async enrichWord(id, data, expectedAccessTime) {
    const db = await this.open();
    const tx = db.transaction('words', 'readwrite');
    const done = completed(tx);
    const store = tx.objectStore('words');
    let result = null;
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result) {
        result = req.result;
        if (expectedAccessTime === undefined || result.lastAccessedAt === expectedAccessTime) {
          result = mergeDetails(result, data);
          store.put(result);
        }
      }
    };
    await done;
    return result;
  }

  async queryWords(options = {}) {
    const db = await this.open();
    const tx = db.transaction('words');
    const store = tx.objectStore('words');
    const orderBy = ['word', 'frequency', 'createdAt', 'lastAccessedAt'].includes(options.orderBy)
      ? options.orderBy
      : 'lastAccessedAt';
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    const offset = Math.max(0, Number(options.offset) || 0);
    const query = textField(options.query).trim().toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfWeek = weekStart();
    return new Promise((resolve, reject) => {
      const words = [];
      let total = 0;
      const req = store.index(orderBy).openCursor(null, options.order === 'asc' ? 'next' : 'prev');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve({ words, total });
        const w = cursor.value;
        const type = w.type || 'word';
        const typeOK =
          !options.type ||
          options.type === 'all' ||
          (options.type === 'words-phrases' ? type !== 'sentence' : type === options.type);
        const filter = options.filter;
        const timeOK =
          !filter ||
          filter === 'all' ||
          (filter === 'today' && w.createdAt >= +today) ||
          (filter === 'week' && w.createdAt >= startOfWeek) ||
          mastery(w.mastery) === filter;
        const searchOK =
          !query ||
          [
            w.word,
            w.displayText,
            w.translation,
            ...(w.definitions || []).map((d) => d.meaning),
          ].some((s) => typeof s === 'string' && s.toLowerCase().includes(query));
        if (typeOK && timeOK && searchOK) {
          if (total >= offset && words.length < limit) words.push(w);
          total++;
        }
        cursor.continue();
      };
    });
  }
  async getWords(options = {}) {
    return (await this.queryWords(options)).words;
  }
  async searchWords(query) {
    return (await this.queryWords({ query, limit: 100 })).words;
  }
  async getWordWithContexts(id) {
    const db = await this.open();
    const tx = db.transaction(['words', 'contexts']);
    const [word, contexts] = await Promise.all([
      asPromise(tx.objectStore('words').get(id)),
      asPromise(tx.objectStore('contexts').index('wordId').getAll(id)),
    ]);
    return word ? { ...word, contexts: contexts.sort((a, b) => b.createdAt - a.createdAt) } : null;
  }
  async deleteWord(id) {
    const db = await this.open();
    const tx = db.transaction(['words', 'contexts'], 'readwrite');
    const done = completed(tx);
    tx.objectStore('words').delete(id);
    const req = tx.objectStore('contexts').index('wordId').openCursor(id);
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        c.delete();
        c.continue();
      }
    };
    await done;
  }
  async exportData() {
    const db = await this.open();
    const tx = db.transaction(['words', 'contexts']);
    const [words, contexts] = await Promise.all([
      asPromise(tx.objectStore('words').getAll()),
      asPromise(tx.objectStore('contexts').getAll()),
    ]);
    return { version: DB_VERSION, exportedAt: new Date().toISOString(), words, contexts };
  }

  async importData(data) {
    if (
      !data ||
      !Array.isArray(data.words) ||
      data.words.length > 50000 ||
      (data.contexts && !Array.isArray(data.contexts))
    )
      throw new Error('请选择有效的 WordVoice JSON 备份（最多 50000 条）');
    if ((data.contexts?.length || 0) > 100000) throw new Error('上下文记录超过 100000 条');
    const stats = { imported: 0, merged: 0, skipped: 0 };
    const ids = new Set();
    const rows = data.words.map((w) => {
      if (!w || typeof w !== 'object') throw new Error('备份包含无效词条');
      const displayText = normalizeText(w.displayText || w.word);
      if (w.id !== undefined && (!Number.isSafeInteger(w.id) || w.id <= 0 || ids.has(w.id)))
        throw new Error('备份包含无效或重复的词条 ID');
      if (w.id !== undefined) ids.add(w.id);
      return {
        oldId: w.id,
        row: {
          word: displayText.toLowerCase(),
          displayText,
          ...details(w),
          type: getTextType(displayText),
          frequency: count(w.frequency),
          mastery: mastery(w.mastery),
          notes: textField(w.notes, 10000),
          tags: Array.isArray(w.tags)
            ? w.tags
                .filter((t) => typeof t === 'string')
                .slice(0, 50)
                .map((t) => t.slice(0, 100))
            : [],
          createdAt: timestamp(w.createdAt),
          lastAccessedAt: timestamp(w.lastAccessedAt),
          lastReviewedAt: Number(w.lastReviewedAt) || 0,
        },
      };
    });
    const contexts = new Map();
    for (const c of data.contexts || []) {
      if (!c || !ids.has(c.wordId)) {
        stats.skipped++;
        continue;
      }
      const list = contexts.get(c.wordId) || [];
      list.push(c);
      contexts.set(c.wordId, list);
    }
    const db = await this.open();
    const tx = db.transaction(['words', 'contexts'], 'readwrite');
    const done = completed(tx);
    const store = tx.objectStore('words');
    // Queue each record after the preceding write to merge duplicate words reliably.
    let index = 0;
    const next = () => {
      if (index >= rows.length) return;
      const { oldId, row } = rows[index++];
      const get = store.index('word').get(row.word);
      get.onsuccess = () => {
        const existing = get.result;
        let merged = row;
        if (existing) {
          const incomingNewer = row.lastAccessedAt > existing.lastAccessedAt;
          merged = {
            ...mergeDetails(row, existing),
            ...existing,
            ...details(incomingNewer ? mergeDetails(existing, row) : mergeDetails(row, existing)),
            frequency: Math.max(count(existing.frequency), row.frequency),
            createdAt: Math.min(existing.createdAt, row.createdAt),
            lastAccessedAt: Math.max(existing.lastAccessedAt, row.lastAccessedAt),
            mastery:
              row.lastReviewedAt > (existing.lastReviewedAt || 0)
                ? row.mastery
                : mastery(existing.mastery),
            lastReviewedAt: Math.max(existing.lastReviewedAt || 0, row.lastReviewedAt),
          };
          stats.merged++;
        } else stats.imported++;
        const put = store.put(merged);
        put.onsuccess = () => {
          // Sequentially deduplicate imported contexts in this transaction.
          const pending = (contexts.get(oldId) || []).slice(-MAX_CONTEXTS);
          const contextStore = tx.objectStore('contexts');
          const getContexts = contextStore.index('wordId').getAll(put.result);
          getContexts.onsuccess = () => {
            const existingContexts = getContexts.result;
            const keys = new Set(
              existingContexts.map((c) => JSON.stringify([c.pageUrl, c.sentence])),
            );
            for (const value of pending) {
              const c = contextRecord(value, put.result);
              const key = JSON.stringify([c.pageUrl, c.sentence]);
              if (keys.has(key)) continue;
              keys.add(key);
              existingContexts.push(c);
            }
            existingContexts.sort((a, b) => b.createdAt - a.createdAt);
            const retained = existingContexts.slice(0, MAX_CONTEXTS);
            for (const c of existingContexts.slice(MAX_CONTEXTS))
              if (c.id) contextStore.delete(c.id);
            for (const c of retained) if (!c.id) contextStore.add(c);
            next();
          };
        };
      };
    };
    next();
    await done;
    return stats;
  }

  async getStatsSummary(days = 14) {
    const db = await this.open();
    const words = await asPromise(db.transaction('words').objectStore('words').getAll());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daily = [];
    for (let i = Math.max(1, Math.min(90, days)) - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      daily.push({
        date: `${date.getMonth() + 1}/${date.getDate()}`,
        start: +date,
        end: +end,
        count: 0,
      });
    }
    const stats = { total: words.length, today: 0, week: 0, totalFrequency: 0 };
    const levels = { new: 0, learning: 0, mastered: 0, total: words.length };
    for (const w of words) {
      stats.totalFrequency += count(w.frequency);
      if (w.createdAt >= +today) stats.today++;
      if (w.createdAt >= weekStart(today)) stats.week++;
      levels[mastery(w.mastery)]++;
      const day = daily.find((d) => w.createdAt >= d.start && w.createdAt < d.end);
      if (day) day.count++;
    }
    return { stats, mastery: levels, daily: daily.map(({ date, count }) => ({ date, count })) };
  }
  async getStats() {
    return (await this.getStatsSummary()).stats;
  }
  async getDailyStats(days) {
    return (await this.getStatsSummary(days)).daily;
  }
  async getMasteryStats() {
    return (await this.getStatsSummary()).mastery;
  }
  async getWordsForReview(limit = 20) {
    const db = await this.open();
    const words = await asPromise(db.transaction('words').objectStore('words').getAll());
    const order = { new: 0, learning: 1, mastered: 2 };
    return words
      .filter((w) => (w.type || 'word') !== 'sentence')
      .sort(
        (a, b) =>
          order[mastery(a.mastery)] - order[mastery(b.mastery)] ||
          (a.lastReviewedAt || 0) - (b.lastReviewedAt || 0) ||
          b.frequency - a.frequency,
      )
      .slice(0, Math.max(1, Math.min(100, limit)));
  }
  async updateMastery(id, value) {
    if (!['new', 'learning', 'mastered'].includes(value)) throw new Error('无效的掌握度');
    const db = await this.open();
    const tx = db.transaction('words', 'readwrite');
    const done = completed(tx);
    let found = false;
    const store = tx.objectStore('words');
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result) {
        found = true;
        store.put({ ...req.result, mastery: value, lastReviewedAt: Date.now() });
      }
    };
    await done;
    if (!found) throw new Error('词条已删除，请刷新单词本');
  }

  async getCache(cacheKey, storeName = 'lookup_cache') {
    const db = await this.open();
    const row = await asPromise(db.transaction(storeName).objectStore(storeName).get(cacheKey));
    return row && row.expiresAt > Date.now() ? row.value : null;
  }
  async setCache(cacheKey, value, ttl = 7 * 86400000, storeName = 'lookup_cache') {
    const size = JSON.stringify(value).length * 2;
    if (size > 4 * 1024 * 1024) return;
    const db = await this.open();
    const tx = db.transaction(storeName, 'readwrite');
    const done = completed(tx);
    const store = tx.objectStore(storeName);
    store.put({ cacheKey, value, size, createdAt: Date.now(), expiresAt: Date.now() + ttl });
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = req.result.sort((a, b) => b.createdAt - a.createdAt);
      let bytes = 0;
      let kept = 0;
      for (const row of rows) {
        bytes += row.size || 0;
        if (
          !row.expiresAt ||
          row.expiresAt <= Date.now() ||
          ++kept > (storeName === 'audio_cache' ? AUDIO_LIMIT : CACHE_LIMIT) ||
          bytes > (storeName === 'audio_cache' ? AUDIO_BYTES : 8 * 1024 * 1024)
        )
          store.delete(row.cacheKey);
      }
    };
    await done;
  }
  async getAudioCache(key) {
    return this.getCache(key, 'audio_cache');
  }
  async saveAudioCache(key, audioData, mimeType = 'audio/mpeg') {
    return this.setCache(key, { audioData, mimeType }, 30 * 86400000, 'audio_cache');
  }
  async getAudioCacheStats() {
    const db = await this.open();
    const rows = await asPromise(db.transaction('audio_cache').objectStore('audio_cache').getAll());
    return {
      count: rows.length,
      estimatedSizeKB: Math.round(
        rows.reduce((n, r) => n + (r.value?.audioData || r.audioData || '').length * 0.75, 0) /
          1024,
      ),
    };
  }
  async clearAudioCache() {
    const db = await this.open();
    const tx = db.transaction('audio_cache', 'readwrite');
    const done = completed(tx);
    tx.objectStore('audio_cache').clear();
    await done;
  }
}
export default new WordVoiceDB();
