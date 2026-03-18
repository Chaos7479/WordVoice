// WordVoice IndexedDB 数据库封装

const DB_NAME = 'WordVoiceDB';
const DB_VERSION = 3;

class WordVoiceDB {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        this.db.onclose = () => { this.db = null; };
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 单词表
        if (!db.objectStoreNames.contains('words')) {
          const wordStore = db.createObjectStore('words', {
            keyPath: 'id',
            autoIncrement: true
          });
          wordStore.createIndex('word', 'word', { unique: true });
          wordStore.createIndex('frequency', 'frequency', { unique: false });
          wordStore.createIndex('createdAt', 'createdAt', { unique: false });
          wordStore.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          wordStore.createIndex('mastery', 'mastery', { unique: false });
        }

        // 上下文表
        if (!db.objectStoreNames.contains('contexts')) {
          const contextStore = db.createObjectStore('contexts', {
            keyPath: 'id',
            autoIncrement: true
          });
          contextStore.createIndex('wordId', 'wordId', { unique: false });
          contextStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 学习记录表
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', {
            keyPath: 'id',
            autoIncrement: true
          });
          logStore.createIndex('wordId', 'wordId', { unique: false });
          logStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 音频缓存表
        if (!db.objectStoreNames.contains('audio_cache')) {
          db.createObjectStore('audio_cache', { keyPath: 'cacheKey' });
        }

        // v3: words 表新增 type 索引
        if (db.objectStoreNames.contains('words')) {
          const wordsStore = event.target.transaction.objectStore('words');
          if (!wordsStore.indexNames.contains('type')) {
            wordsStore.createIndex('type', 'type', { unique: false });
          }
        }
      };
    });
  }

  async getDB() {
    if (!this.db) {
      await this.open();
    }
    return this.db;
  }

  // 添加或更新单词
  async saveWord(wordData) {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    const index = store.index('word');

    return new Promise((resolve, reject) => {
      // 先查找是否已存在
      const getRequest = index.get(wordData.word.toLowerCase());

      getRequest.onsuccess = () => {
        const existing = getRequest.result;

        if (existing) {
          // 更新现有记录
          const updated = {
            ...existing,
            frequency: existing.frequency + 1,
            lastAccessedAt: Date.now(),
            // 更新音标和释义（如果有新数据）
            phonetic: wordData.phonetic || existing.phonetic,
            definitions: wordData.definitions || existing.definitions,
            audioUrl: wordData.audioUrl || existing.audioUrl,
            translation: wordData.translation || existing.translation || '',
            type: existing.type || wordData.type || 'word'
          };
          const putRequest = store.put(updated);
          putRequest.onsuccess = () => resolve({ ...updated, isNew: false });
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          // 添加新记录
          const newWord = {
            word: wordData.word.toLowerCase(),
            phonetic: wordData.phonetic || '',
            definitions: wordData.definitions || [],
            audioUrl: wordData.audioUrl || '',
            translation: wordData.translation || '',
            type: wordData.type || 'word',
            frequency: 1,
            mastery: 'new',
            tags: [],
            notes: '',
            createdAt: Date.now(),
            lastAccessedAt: Date.now()
          };
          const addRequest = store.add(newWord);
          addRequest.onsuccess = () => resolve({ ...newWord, id: addRequest.result, isNew: true });
          addRequest.onerror = () => reject(addRequest.error);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // 添加上下文
  async addContext(contextData) {
    const db = await this.getDB();
    const tx = db.transaction('contexts', 'readwrite');
    const store = tx.objectStore('contexts');

    const context = {
      wordId: contextData.wordId,
      sentence: contextData.sentence || '',
      pageUrl: contextData.pageUrl || '',
      pageTitle: contextData.pageTitle || '',
      aiSentence: contextData.aiSentence || '',
      createdAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      const request = store.add(context);
      request.onsuccess = () => resolve({ ...context, id: request.result });
      request.onerror = () => reject(request.error);
    });
  }

  // 获取单词列表
  async getWords(options = {}) {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');

    const { limit = 50, offset = 0, orderBy = 'lastAccessedAt', order = 'desc', type } = options;
    const filterType = type && type !== 'all' ? type : null;

    return new Promise((resolve, reject) => {
      const results = [];
      const index = store.index(orderBy);
      const direction = order === 'desc' ? 'prev' : 'next';
      let count = 0;

      const request = index.openCursor(null, direction);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const itemType = cursor.value.type || 'word';
          if (!filterType || itemType === filterType) {
            if (count >= offset && results.length < limit) {
              results.push(cursor.value);
            }
            count++;
          }
          if (results.length < limit) {
            cursor.continue();
          } else {
            resolve(results);
          }
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 搜索单词
  async searchWords(query) {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');

    return new Promise((resolve, reject) => {
      const results = [];
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.word.includes(query.toLowerCase())) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 获取单词的上下文列表
  async getContextsByWordId(wordId) {
    const db = await this.getDB();
    const tx = db.transaction('contexts', 'readonly');
    const store = tx.objectStore('contexts');
    const index = store.index('wordId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(wordId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 获取单词详情（包含上下文）
  async getWordWithContexts(wordId) {
    const db = await this.getDB();

    // 获取单词
    const wordTx = db.transaction('words', 'readonly');
    const wordStore = wordTx.objectStore('words');

    const word = await new Promise((resolve, reject) => {
      const request = wordStore.get(wordId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (!word) return null;

    // 获取上下文
    const contexts = await this.getContextsByWordId(wordId);

    return { ...word, contexts };
  }

  // 获取统计数据
  async getStats() {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekTimestamp = weekAgo.getTime();

    return new Promise((resolve, reject) => {
      let total = 0;
      let todayCount = 0;
      let weekCount = 0;
      let totalFrequency = 0;

      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          total++;
          totalFrequency += cursor.value.frequency;

          if (cursor.value.createdAt >= todayTimestamp) {
            todayCount++;
          }
          if (cursor.value.createdAt >= weekTimestamp) {
            weekCount++;
          }
          cursor.continue();
        } else {
          resolve({
            total,
            today: todayCount,
            week: weekCount,
            totalFrequency
          });
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 删除单词（单事务，保证原子性）
  async deleteWord(wordId) {
    const db = await this.getDB();
    const tx = db.transaction(['words', 'contexts'], 'readwrite');

    // 删除单词
    const wordStore = tx.objectStore('words');
    await new Promise((resolve, reject) => {
      const request = wordStore.delete(wordId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // 删除相关上下文（同一事务）
    const contextStore = tx.objectStore('contexts');
    const contextIndex = contextStore.index('wordId');

    return new Promise((resolve, reject) => {
      const request = contextIndex.openCursor(wordId);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 导出所有数据
  async exportData() {
    const words = await this.getWords({ limit: 10000 });
    const db = await this.getDB();
    const contextTx = db.transaction('contexts', 'readonly');
    const contextStore = contextTx.objectStore('contexts');

    const contexts = await new Promise((resolve, reject) => {
      const request = contextStore.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      words,
      contexts
    };
  }

  // 导入数据
  async importData(jsonData) {
    // 1. 校验 JSON 格式
    if (!jsonData || !Array.isArray(jsonData.words)) {
      throw new Error('无效的导入数据格式：缺少 words 数组');
    }

    const db = await this.getDB();
    const stats = { imported: 0, merged: 0, skipped: 0 };
    const oldToNewIdMap = new Map(); // 映射旧 ID 到新 ID

    // 2. 导入单词
    for (const wordData of jsonData.words) {
      try {
        const tx = db.transaction('words', 'readwrite');
        const store = tx.objectStore('words');
        const index = store.index('word');

        // 查找是否已存在
        const existing = await new Promise((resolve, reject) => {
          const request = index.get(wordData.word.toLowerCase());
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        if (existing) {
          // 已存在：合并数据
          const updated = {
            ...existing,
            frequency: existing.frequency + (wordData.frequency || 1),
            lastAccessedAt: Date.now(),
            // 更新音标和释义（如果导入数据更完整）
            phonetic: wordData.phonetic || existing.phonetic,
            definitions: wordData.definitions?.length > 0 ? wordData.definitions : existing.definitions,
            audioUrl: wordData.audioUrl || existing.audioUrl,
            type: existing.type || wordData.type || 'word'
          };

          await new Promise((resolve, reject) => {
            const putRequest = store.put(updated);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          });

          oldToNewIdMap.set(wordData.id, existing.id);
          stats.merged++;
        } else {
          // 不存在：添加新单词（不包含原始 id）
          const newWord = {
            word: wordData.word.toLowerCase(),
            phonetic: wordData.phonetic || '',
            definitions: wordData.definitions || [],
            audioUrl: wordData.audioUrl || '',
            type: wordData.type || 'word',
            frequency: wordData.frequency || 1,
            mastery: wordData.mastery || 'new',
            tags: wordData.tags || [],
            notes: wordData.notes || '',
            createdAt: wordData.createdAt || Date.now(),
            lastAccessedAt: wordData.lastAccessedAt || Date.now()
          };

          const newId = await new Promise((resolve, reject) => {
            const addRequest = store.add(newWord);
            addRequest.onsuccess = () => resolve(addRequest.result);
            addRequest.onerror = () => reject(addRequest.error);
          });

          oldToNewIdMap.set(wordData.id, newId);
          stats.imported++;
        }
      } catch (error) {
        console.error('导入单词失败:', wordData.word, error);
        stats.skipped++;
      }
    }

    // 3. 导入上下文
    if (Array.isArray(jsonData.contexts)) {
      for (const contextData of jsonData.contexts) {
        try {
          const newWordId = oldToNewIdMap.get(contextData.wordId);
          if (!newWordId) {
            stats.skipped++;
            continue;
          }

          const tx = db.transaction('contexts', 'readwrite');
          const store = tx.objectStore('contexts');

          const context = {
            wordId: newWordId,
            sentence: contextData.sentence || '',
            pageUrl: contextData.pageUrl || '',
            pageTitle: contextData.pageTitle || '',
            aiSentence: contextData.aiSentence || '',
            createdAt: contextData.createdAt || Date.now()
          };

          await new Promise((resolve, reject) => {
            const request = store.add(context);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
        } catch (error) {
          console.error('导入上下文失败:', contextData, error);
          stats.skipped++;
        }
      }
    }

    return stats;
  }

  // 获取每日新增单词统计（过去 N 天）
  async getDailyStats(days = 14) {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');

    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    return new Promise((resolve, reject) => {
      // 初始化每天计数
      const dailyCounts = {};
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        dailyCounts[key] = 0;
      }

      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const createdAt = cursor.value.createdAt;
          if (createdAt >= startDate.getTime()) {
            const d = new Date(createdAt);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            if (key in dailyCounts) {
              dailyCounts[key]++;
            }
          }
          cursor.continue();
        } else {
          // 转为有序数组
          const result = Object.entries(dailyCounts).map(([date, count]) => ({ date, count }));
          resolve(result);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取掌握度分布统计
  async getMasteryStats() {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');

    return new Promise((resolve, reject) => {
      const stats = { new: 0, learning: 0, mastered: 0 };
      let total = 0;

      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          total++;
          const mastery = cursor.value.mastery || 'new';
          if (mastery in stats) {
            stats[mastery]++;
          } else {
            stats['new']++;
          }
          cursor.continue();
        } else {
          resolve({ ...stats, total });
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取待复习单词（优先低掌握度、高频率）
  async getWordsForReview(limit = 20) {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readonly');
    const store = tx.objectStore('words');

    return new Promise((resolve, reject) => {
      const results = [];
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          // 排序逻辑：
          // 1. mastery='new' 优先
          // 2. mastery='learning' 次之
          // 3. mastery='mastered' 最后
          // 4. 同等级内按 frequency 降序
          const masteryOrder = { 'new': 0, 'learning': 1, 'mastered': 2 };
          results.sort((a, b) => {
            const orderA = masteryOrder[a.mastery] ?? 0;
            const orderB = masteryOrder[b.mastery] ?? 0;
            if (orderA !== orderB) {
              return orderA - orderB;
            }
            return (b.frequency || 0) - (a.frequency || 0);
          });

          resolve(results.slice(0, limit));
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 更新单词掌握度
  async updateMastery(wordId, mastery) {
    const db = await this.getDB();
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');

    return new Promise((resolve, reject) => {
      const getRequest = store.get(wordId);

      getRequest.onsuccess = () => {
        const word = getRequest.result;
        if (!word) {
          reject(new Error('Word not found'));
          return;
        }

        word.mastery = mastery;
        const putRequest = store.put(word);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // 保存音频缓存
  async saveAudioCache(cacheKey, audioData, mimeType) {
    const db = await this.getDB();
    const tx = db.transaction('audio_cache', 'readwrite');
    const store = tx.objectStore('audio_cache');

    return new Promise((resolve, reject) => {
      const request = store.put({
        cacheKey,
        audioData,
        mimeType: mimeType || 'audio/mpeg',
        createdAt: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 获取音频缓存
  async getAudioCache(cacheKey) {
    const db = await this.getDB();
    const tx = db.transaction('audio_cache', 'readonly');
    const store = tx.objectStore('audio_cache');

    return new Promise((resolve, reject) => {
      const request = store.get(cacheKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  // 获取音频缓存统计
  async getAudioCacheStats() {
    const db = await this.getDB();
    const tx = db.transaction('audio_cache', 'readonly');
    const store = tx.objectStore('audio_cache');

    return new Promise((resolve, reject) => {
      let count = 0;
      let totalBytes = 0;

      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          count++;
          const data = cursor.value.audioData || '';
          totalBytes += data.length;
          cursor.continue();
        } else {
          // base64 字符串长度 × 0.75 ≈ 实际二进制大小
          resolve({
            count,
            estimatedSizeKB: Math.round(totalBytes * 0.75 / 1024)
          });
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 清除全部音频缓存
  async clearAudioCache() {
    const db = await this.getDB();
    const tx = db.transaction('audio_cache', 'readwrite');
    const store = tx.objectStore('audio_cache');

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// 导出单例
const db = new WordVoiceDB();
export default db;
