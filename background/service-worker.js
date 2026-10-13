import db from '../lib/db.js';
import tts, { getVoices } from '../lib/tts.js';
import { fetchWordData } from '../lib/lookup.js';
import { translateWord, translateDirect } from '../lib/translate.js';
import { getSettings, saveSettings, PROVIDER_LIST, normalizeSettings } from '../lib/settings.js';
import { generateSentences } from '../lib/ai-sentences.js';
import { complete } from '../lib/llm.js';
import { normalizeText, getTextType, textField, safePageUrl } from '../lib/text.js';

function notifyViews() {
  chrome.runtime.sendMessage({ action: 'dataChanged' }).catch(() => {});
}
function sendUpdate(sender, requestId, update) {
  if (!sender.tab?.id) return Promise.resolve();
  const target = sender.documentId
    ? { documentId: sender.documentId }
    : { frameId: sender.frameId || 0 };
  return chrome.tabs
    .sendMessage(sender.tab.id, { action: 'lookupUpdate', requestId, ...update }, target)
    .catch(() => {});
}
async function handlePronounce(message, sender) {
  const word = normalizeText(message.word);
  const requestId = textField(message.requestId, 100);
  const settingsPromise = getSettings();
  // Begin speech immediately. Dictionary, translation and storage never block browser speech.
  const speechPromise = tts
    .speak(word)
    .then(async (result) => {
      await sendUpdate(sender, requestId, {
        speech: result.ttsSource.label,
        speechWarning: result.fallbackReason || '',
        speaking: true,
      });
      return result;
    })
    .catch(async (error) => {
      const cancelled = error.name === 'AbortError';
      if (cancelled) await sendUpdate(sender, requestId, { stopped: true, speaking: false });
      else await sendUpdate(sender, requestId, { speechError: error.message, speaking: false });
      return { error: error.message, cancelled };
    });
  const savePromise = db
    .saveWord(
      { word },
      {
        sentence: textField(message.sentence),
        pageUrl: safePageUrl(sender.url || message.pageUrl),
        pageTitle: textField(message.pageTitle, 500),
      },
    )
    .then(async (saved) => {
      await sendUpdate(sender, requestId, {
        saved: true,
        isNew: saved.isNew,
        frequency: saved.frequency,
      });
      notifyViews();
      return saved;
    })
    .catch(async (error) => {
      await sendUpdate(sender, requestId, { saveError: error.message });
      return null;
    });
  const settings = await settingsPromise;
  const dictionary =
    settings.sourceLanguage === 'en' && getTextType(word) === 'word'
      ? fetchWordData(word, settings.pronunciation).catch(() => ({ definitions: [] }))
      : Promise.resolve({ definitions: [] });
  const translation = settings.showTranslation
    ? translateWord(
        word,
        settings.translationProvider,
        settings.providers[settings.translationProvider] || {},
        4000,
        settings.sourceLanguage,
        settings.targetLanguage,
      ).catch(() => '')
    : Promise.resolve('');
  const [wordData, translated] = await Promise.all([dictionary, translation]);
  await sendUpdate(sender, requestId, {
    phonetic: wordData.phonetic || '',
    translation: translated,
    definition: wordData.definitions?.[0]?.meaning || '',
    lookupDone: true,
    lookupWarning: settings.showTranslation && !translated ? '翻译暂不可用，可稍后重试' : '',
  });
  const saved = await savePromise;
  if (saved) {
    await db.enrichWord(
      saved.id,
      {
        ...wordData,
        translation: translated,
        translationLanguage: translated ? settings.targetLanguage : '',
      },
      saved.lastAccessedAt,
    );
    notifyViews();
  }
  const speech = await speechPromise;
  return { word: saved, isNew: saved?.isNew || false, speech };
}

const handlers = {
  pronounce: handlePronounce,
  ping: async () => ({}),
  stopSpeech: () => tts.stopSpeech().then(() => ({})),
  playOnly: (message) => tts.speak(normalizeText(message.word)).then((speech) => ({ speech })),
  getWords: (message) => db.queryWords(message.options || {}),
  searchWords: async (message) => ({ words: await db.searchWords(message.query) }),
  getStats: async () => ({ stats: await db.getStats() }),
  getStatsSummary: () => db.getStatsSummary(),
  getWordWithContexts: async (message) => ({
    word: await db.getWordWithContexts(validId(message.wordId)),
  }),
  deleteWord: async (message) => {
    await db.deleteWord(validId(message.wordId));
    notifyViews();
    return {};
  },
  exportData: async () => ({ data: await db.exportData() }),
  importData: async (message) => {
    const stats = await db.importData(message.data);
    notifyViews();
    return { stats };
  },
  getWordsForReview: async (message) => ({ words: await db.getWordsForReview(message.limit) }),
  updateMastery: async (message) => {
    await db.updateMastery(validId(message.wordId), message.mastery);
    notifyViews();
    return {};
  },
  getSettings: async () => ({ settings: await getSettings() }),
  saveSettings: async (message) => {
    await saveSettings(message.settings);
    return {};
  },
  translateWord: async (message) => {
    const settings = await getSettings();
    if (!settings.showTranslation) return { translation: '' };
    const word = normalizeText(message.word);
    const translation = await translateWord(
      word,
      settings.translationProvider,
      settings.providers[settings.translationProvider] || {},
      4000,
      settings.sourceLanguage,
      settings.targetLanguage,
    );
    if (message.wordId) {
      const existing = await db.getWordWithContexts(validId(message.wordId));
      if (existing?.word === word.toLowerCase()) {
        await db.enrichWord(existing.id, {
          translation,
          translationLanguage: settings.targetLanguage,
        });
        notifyViews();
      }
    }
    return { translation };
  },
  generateSentences: async (message) => {
    const settings = await getSettings();
    const sentences = await generateSentences(
      message.word,
      settings.aiProvider,
      settings.providers[settings.aiProvider],
    );
    return { sentences };
  },
  getTtsLog: async () => ({
    log: await tts.getTtsLog(),
    degradations: await tts.getConsecutiveDegradations(),
  }),
  getBrowserVoices: async () => ({ voices: await getVoices(true) }),
  getTtsStatus: async () => {
    const settings = await getSettings();
    const provider = settings.ttsProvider;
    const config = settings.providers[provider] || {};
    return {
      provider,
      providerName: PROVIDER_LIST.find((p) => p.id === provider)?.name,
      voice: config.voice || config.voiceType || config.voiceId || '',
      pronunciation: settings.pronunciation,
      configured:
        ['chrome-tts', 'free-dict'].includes(provider) ||
        (provider === 'doubao' ? !!(config.appId && config.accessToken) : !!config.apiKey),
    };
  },
  testApi: async (message) => {
    const { type, provider, config = {} } = message;
    const settings = normalizeSettings({ ...(await getSettings()), ...message.preferences });
    const start = Date.now();
    try {
      let result;
      if (type === 'tts') {
        settings.ttsProvider = provider;
        settings.providers[provider] = config;
        result = (
          await tts.speak(
            provider === 'free-dict' ? 'hello' : 'Hello, welcome to WordVoice.',
            settings,
            { strict: true },
          )
        ).ttsSource.label;
        // Dictionary audio needs a single word.
      } else if (type === 'translation') {
        result = await translateDirect(
          'Hello. Welcome to WordVoice.',
          provider,
          config,
          8000,
          settings.sourceLanguage,
          settings.targetLanguage,
        );
      } else if (type === 'ai') {
        result = await complete(
          provider,
          config,
          'Write one short English sentence using the word provided. Output only the sentence.',
          'hello',
        );
      } else throw new Error('无效的测试类型');
      return {
        result,
        model: config.textModel || config.model || provider,
        logs: [
          {
            time: Date.now() - start,
            level: 'info',
            msg: type === 'tts' ? '音频已开始播放' : '服务已返回结果',
          },
        ],
      };
    } catch (error) {
      return { error: error.message, logs: [] };
    }
  },
};
function validId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('无效的词条 ID');
  return value;
}
const contentActions = new Set(['pronounce', 'stopSpeech', 'ping']);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target === 'offscreen' || message?.action === 'dataChanged') return false;
  if (sender.id !== chrome.runtime.id) return false;
  if (!message || !Object.hasOwn(handlers, message.action)) {
    respond({ success: false, error: '未知操作' });
    return false;
  }
  const isExtensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (!isExtensionPage && !contentActions.has(message.action)) {
    respond({ success: false, error: '请在扩展页面执行此操作' });
    return false;
  }
  Promise.resolve()
    .then(() => handlers[message.action](message, sender))
    .then((result) => respond({ success: true, ...result }))
    .catch((error) => respond({ success: false, error: error.message || '操作失败，请重试' }));
  return true;
});

async function inject(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content/content.js'],
  });
}
chrome.commands.onCommand.addListener(async (command, commandTab) => {
  if (command !== 'pronounce-selection') return;
  try {
    const tab = commandTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'getSelection' });
    } catch {
      await inject(tab.id);
      await chrome.tabs.sendMessage(tab.id, { action: 'getSelection' });
    }
  } catch {
    /* Chrome restricts extension scripts on its own pages and Web Store. */
  }
});
chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    await getSettings();
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await db.open();
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.allSettled(tabs.filter((t) => t.id).map((t) => inject(t.id)));
  })().catch((error) => console.error('WordVoice initialization:', error.message));
});
