// WordVoice Service Worker

import db from '../lib/db.js';
import tts from '../lib/tts.js';
import { translateWord, getDefinitionSummary } from '../lib/translate.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { generateSentences } from '../lib/ai-sentences.js';
import { getProviderAudio } from '../lib/tts-providers.js';

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'pronounce-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      chrome.tabs.sendMessage(tab.id, { action: 'getSelection' });
    } catch (error) {
      console.error('Failed to send message to content script:', error);
    }
  }
});

// 消息处理器映射表
const messageHandlers = {
  // 处理发音请求（返回值已包含 success 字段，需要特殊处理）
  pronounce: (message, sender) => handlePronounce(message, sender),

  // 获取单词列表（支持 type 筛选）
  getWords: (message) => {
    const options = { ...message.options };
    if (message.type) options.type = message.type;
    return db.getWords(options).then(words => ({ words }));
  },

  // 搜索单词
  searchWords: (message) => db.searchWords(message.query).then(words => ({ words })),

  // 获取统计数据
  getStats: () => db.getStats().then(stats => ({ stats })),

  // 获取单词详情
  getWordWithContexts: (message) => db.getWordWithContexts(message.wordId).then(word => ({ word })),

  // 删除单词
  deleteWord: (message) => db.deleteWord(message.wordId).then(() => ({})),

  // 导出数据
  exportData: () => db.exportData().then(data => ({ data })),

  // 导入数据
  importData: (message) => db.importData(message.data).then(stats => ({ stats })),

  // 仅播放发音（不保存）
  playOnly: (message) => tts.pronounce(message.word).then(() => ({})),

  // 获取设置
  getSettings: () => getSettings().then(settings => ({ settings })),

  // 保存设置
  saveSettings: (message) => saveSettings(message.settings).then(() => ({})),

  // 获取待复习单词
  getWordsForReview: (message) => db.getWordsForReview(message.limit).then(words => ({ words })),

  // 更新单词掌握度
  updateMastery: (message) => db.updateMastery(message.wordId, message.mastery).then(() => ({})),

  // 获取每日新增统计
  getDailyStats: (message) => db.getDailyStats(message.days).then(daily => ({ daily })),

  // 获取掌握度分布
  getMasteryStats: () => db.getMasteryStats().then(mastery => ({ mastery })),

  // 翻译单词
  translateWord: async (message) => {
    const settings = await getSettings();
    const provider = settings.translationProvider || 'google';
    const config = settings.providers?.[provider] || {};
    const sourceLang = settings.sourceLanguage || 'en';
    const targetLang = settings.targetLanguage || 'zh-CN';
    const translation = await translateWord(message.word, provider, config, 3000, sourceLang, targetLang);
    return { translation };
  },

  // 测试 API 连接（返回详细日志）
  testApi: async (message) => {
    const { type, provider, config } = message;
    const testWord = 'hello';
    const logs = [];
    const startTime = Date.now();

    const log = (level, msg, data) => {
      logs.push({ time: Date.now() - startTime, level, msg, data: data ?? null });
    };

    try {
      if (type === 'translation') {
        log('info', `翻译测试 [${provider}]`, { word: testWord });

        if (provider === 'google') {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${testWord}`;
          log('req', 'GET ' + url.substring(0, 80) + '...');
          const resp = await fetch(url);
          const raw = await resp.json();
          const translation = raw?.[0]?.[0]?.[0] || '';
          log('res', `HTTP ${resp.status}`, { translation, raw_snippet: JSON.stringify(raw).substring(0, 200) });
          return { logs, result: translation, model: 'Google Translate (免费)' };
        }

        // Qwen / Doubao / MiniMax — LLM 翻译
        const endpoints = {
          qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo', keyField: 'apiKey', authPrefix: 'Bearer' },
          doubao: { url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: 'doubao-lite-32k', keyField: 'accessToken', authPrefix: 'Bearer' },
          minimax: { url: 'https://api.minimax.chat/v1/text/chatcompletion_v2', model: 'MiniMax-Text-01', keyField: 'apiKey', authPrefix: 'Bearer' }
        };

        const ep = endpoints[provider];
        if (!ep) throw new Error('未知翻译服务商: ' + provider);

        const key = config[ep.keyField];
        if (!key) throw new Error(`未配置 ${ep.keyField}，请填写后重试`);

        log('req', `POST ${ep.url}`, { model: ep.model, key_preview: key.substring(0, 8) + '***' });
        const resp = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Authorization': `${ep.authPrefix} ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: ep.model, messages: [{ role: 'user', content: `将以下英文单词翻译为简洁的中文释义（只输出中文，不超过10个字）：${testWord}` }] })
        });
        const data = await resp.json();
        log('res', `HTTP ${resp.status}`, { body: JSON.stringify(data).substring(0, 500) });

        if (!resp.ok) throw new Error(`API 返回 ${resp.status}: ${JSON.stringify(data).substring(0, 200)}`);
        const translation = data.choices?.[0]?.message?.content?.trim() || '';
        if (!translation) throw new Error('API 返回空结果: ' + JSON.stringify(data).substring(0, 300));
        return { logs, result: translation, model: ep.model };

      } else if (type === 'ai') {
        log('info', `AI 例句测试 [${provider}]`, { word: testWord });

        const endpoints = {
          qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo', keyField: 'apiKey' },
          doubao: { url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: 'doubao-lite-32k', keyField: 'accessToken' },
          minimax: { url: 'https://api.minimax.chat/v1/text/chatcompletion_v2', model: 'MiniMax-Text-01', keyField: 'apiKey' }
        };

        const ep = endpoints[provider];
        if (!ep) throw new Error('未知 AI 服务商: ' + provider);

        const key = config[ep.keyField];
        if (!key) throw new Error(`未配置 ${ep.keyField}，请填写后重试`);

        log('req', `POST ${ep.url}`, { model: ep.model, key_preview: key.substring(0, 8) + '***' });
        const resp = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: ep.model, messages: [{ role: 'user', content: `Generate 2 short English example sentences using the word "${testWord}". Only output the sentences.` }] })
        });
        const data = await resp.json();
        log('res', `HTTP ${resp.status}`, { body: JSON.stringify(data).substring(0, 500) });

        if (!resp.ok) throw new Error(`API 返回 ${resp.status}: ${JSON.stringify(data).substring(0, 200)}`);
        const content = data.choices?.[0]?.message?.content?.trim() || '';
        if (!content) throw new Error('API 返回空结果: ' + JSON.stringify(data).substring(0, 300));
        return { logs, result: content, model: ep.model };

      } else if (type === 'tts') {
        log('info', `TTS 测试 [${provider}]`, { text: testWord });

        if (provider === 'free-dict') {
          const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${testWord}`;
          log('req', 'GET ' + url);
          const resp = await fetch(url);
          const data = await resp.json();
          const audioUrl = data?.[0]?.phonetics?.find(p => p.audio)?.audio || '';
          log('res', `HTTP ${resp.status}`, { audioUrl: audioUrl || '(无音频)' });
          if (!audioUrl) throw new Error('Free Dictionary 未返回音频 URL');
          return { logs, result: `音频 URL: ${audioUrl}`, model: 'Free Dictionary API' };
        }

        // DashScope / Doubao / MiniMax TTS
        const keyCheck = {
          dashscope: () => config.apiKey ? null : '未配置 API Key',
          doubao: () => (config.appId && config.accessToken) ? null : '未配置 App ID 或 Access Token',
          minimax: () => (config.groupId && config.apiKey) ? null : '未配置 Group ID 或 API Key'
        };

        const missing = keyCheck[provider]?.();
        if (missing) throw new Error(missing);

        log('req', `调用 ${provider} TTS API`, { config_keys: Object.keys(config).filter(k => config[k]) });
        const audioData = await getProviderAudio(provider, config, testWord);
        const audioSize = audioData ? (audioData.length > 100 ? `${Math.round(audioData.length / 1024)}KB` : audioData.length + 'B') : '0B';
        log('res', '音频数据已返回', { size: audioSize, format: audioData?.substring(0, 30) });
        return { logs, result: `音频已生成 (${audioSize})`, model: provider };

      } else {
        throw new Error('未知测试类型: ' + type);
      }
    } catch (error) {
      log('error', error.message);
      return { logs, error: error.message };
    }
  },

  // 获取 TTS 发音日志
  getTtsLog: () => Promise.resolve({ log: tts.getTtsLog(), degradations: tts.getConsecutiveDegradations() }),

  // 获取当前 TTS 配置摘要
  getTtsStatus: async () => {
    const settings = await getSettings();
    const provider = settings.ttsProvider || 'free-dict';
    const config = settings.providers?.[provider] || {};
    const voiceMap = { dashscope: config.voice, doubao: config.voiceType, minimax: config.voiceId };
    const nameMap = { 'free-dict': 'Free Dictionary', dashscope: 'DashScope (阿里云百炼)', doubao: '豆包 (火山引擎)', minimax: 'MiniMax' };
    const hasKey = provider === 'free-dict' || (provider === 'doubao' ? (config.appId && config.accessToken) : config.apiKey);
    return {
      provider,
      providerName: nameMap[provider] || provider,
      voice: voiceMap[provider] || '',
      pronunciation: settings.pronunciation || 'us',
      configured: !!hasKey
    };
  },

  // 生成 AI 例句
  generateSentences: async (message) => {
    const settings = await getSettings();
    const provider = settings.aiProvider || 'qwen';
    const config = settings.providers[provider] || {};
    // 检查是否配置了 API Key
    const hasKey = provider === 'doubao' ? config.accessToken : config.apiKey;
    if (!hasKey) {
      throw new Error(`请先在设置页面配置 ${provider === 'qwen' ? '通义千问' : provider === 'doubao' ? '豆包' : 'MiniMax'} 的 API Key`);
    }
    const sentences = await generateSentences(message.word, provider, config);
    return { sentences };
  }
};

// 监听来自 content script 和 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 查找对应的处理器
  const handler = messageHandlers[message.action];
  if (!handler) {
    sendResponse({ success: false, error: `Unknown action: ${message.action}` });
    return false;
  }

  // 执行处理器并统一处理响应
  handler(message, sender)
    .then(result => {
      // pronounce 的返回值已包含 success 字段，直接返回
      if (message.action === 'pronounce') {
        sendResponse(result);
      } else {
        // 其他 handler 需要包装 success 字段
        sendResponse({ success: true, ...result });
      }
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });

  return true;
});

// 识别文本类型：word / phrase / sentence
function getTextType(text) {
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount === 1 && /^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(trimmed)) return 'word';
  if (wordCount <= 5) return 'phrase';
  return 'sentence';
}

// 判断是否为英文文本
function isEnglishText(text) {
  return /[a-zA-Z]/.test(text);
}

// 处理发音请求
async function handlePronounce(message, sender) {
  const { word, sentence, pageUrl, pageTitle } = message;

  if (!word || word.trim().length === 0) {
    return { success: false, error: '请先选中文本' };
  }

  const cleanText = word.trim();

  if (!isEnglishText(cleanText)) {
    return { success: false, error: '仅支持英文文本' };
  }

  try {
    const textType = getTextType(cleanText);
    const settings = await getSettings();
    const providerConfig = settings.providers[settings.translationProvider] || {};
    const sourceLang = settings.sourceLanguage || 'en';
    const targetLang = settings.targetLanguage || 'zh-CN';

    if (textType === 'word') {
      // === 单词模式：查字典 + 翻译 + TTS + 保存 ===
      const [wordData, translation] = await Promise.all([
        tts.pronounce(cleanText),
        settings.showTranslation
          ? translateWord(cleanText, settings.translationProvider, providerConfig, 3000, sourceLang, targetLang).catch(() => '')
          : Promise.resolve('')
      ]);

      // 降级处理：如果翻译为空，使用 Free Dictionary 的英文释义
      let finalTranslation = translation;
      if (settings.showTranslation && !finalTranslation && wordData.definitions?.length > 0) {
        finalTranslation = getDefinitionSummary(wordData.definitions);
      }

      // 保存单词（含中文翻译和类型）
      const savedWord = await db.saveWord({ ...wordData, translation: finalTranslation, type: 'word' });

      // 保存上下文
      if (savedWord.id && (sentence || pageUrl)) {
        await db.addContext({
          wordId: savedWord.id,
          sentence: sentence || '',
          pageUrl: pageUrl || '',
          pageTitle: pageTitle || ''
        });
      }

      // 显示反馈（带翻译、音标和 TTS 来源）
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'showToast',
          word: cleanText,
          isNew: savedWord.isNew,
          frequency: savedWord.frequency,
          translation: finalTranslation || '',
          phonetic: wordData.phonetic || '',
          ttsSource: wordData.ttsSource?.label || '',
          degradationWarning: wordData.degradationWarning || false
        }).catch(() => {});
      }

      return { success: true, word: savedWord, isNew: savedWord.isNew };

    } else {
      // === 短语/句子模式：TTS 朗读 + 翻译 + 保存 ===
      const [speakResult, translation] = await Promise.all([
        tts.speakSentence(cleanText),
        settings.showTranslation
          ? translateWord(cleanText, settings.translationProvider, providerConfig, 5000, sourceLang, targetLang).catch(() => '')
          : Promise.resolve('')
      ]);

      // 保存到单词本（含类型）
      const savedWord = await db.saveWord({
        word: cleanText,
        translation: translation || '',
        type: textType
      });

      // 保存上下文
      if (savedWord.id && (sentence || pageUrl)) {
        await db.addContext({
          wordId: savedWord.id,
          sentence: sentence || '',
          pageUrl: pageUrl || '',
          pageTitle: pageTitle || ''
        });
      }

      // 显示反馈（短语/句子显示翻译，不显示音标/词性）
      const displayText = cleanText.length > 40 ? cleanText.substring(0, 40) + '...' : cleanText;
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'showToast',
          word: displayText,
          isNew: savedWord.isNew,
          frequency: savedWord.frequency,
          isSentence: true,
          translation: translation || '',
          ttsSource: speakResult?.ttsSource?.label || '',
          degradationWarning: speakResult?.degradationWarning || false
        }).catch(() => {});
      }

      return { success: true, word: savedWord, isNew: savedWord.isNew, textType };
    }

  } catch (error) {
    console.error('Pronounce error:', error);
    // 给用户友好的中文提示
    let friendlyMsg = '发音失败';
    const msg = error.message || '';
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('fetch')) {
      friendlyMsg = '网络连接超时，请检查网络';
    } else if (msg.includes('API') || msg.includes('401') || msg.includes('403')) {
      friendlyMsg = 'API 认证失败，请检查设置中的 Key 配置';
    }
    return { success: false, error: friendlyMsg };
  }
}

// 安装/更新时强制写入完整 API 配置
chrome.runtime.onInstalled.addListener(async () => {
  db.open().catch(console.error);

  // 直接用 DEFAULTS 覆盖，确保所有 API Key 写入
  try {
    await chrome.storage.sync.remove('settings');
    const freshSettings = await getSettings(); // 返回 DEFAULTS
    await saveSettings(freshSettings);
    console.log('WordVoice: 已写入完整配置，TTS =', freshSettings.ttsProvider);
  } catch (e) {
    console.error('自动配置失败:', e);
  }
});

// 启动时确保数据库就绪
db.open().catch(console.error);
