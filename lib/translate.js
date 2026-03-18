// WordVoice 翻译模块

const GOOGLE_TRANSLATE_API = 'https://translate.googleapis.com/translate_a/single';
const STORAGE_KEY = 'wordvoice_translation_cache';
const MAX_CACHE_SIZE = 2000;

const translateCache = new Map();

// 启动时从 storage 加载缓存
(async function loadCache() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      const entries = Object.entries(result[STORAGE_KEY]);
      entries.forEach(([word, translation]) => {
        translateCache.set(word, translation);
      });
      console.log(`翻译缓存已加载：${entries.length} 条`);
    }
  } catch (error) {
    console.error('加载翻译缓存失败:', error);
  }
})();

// 持久化缓存到 storage
async function saveCache() {
  try {
    const cacheObj = Object.fromEntries(translateCache);
    await chrome.storage.local.set({ [STORAGE_KEY]: cacheObj });
  } catch (error) {
    console.error('保存翻译缓存失败:', error);
  }
}

// ============================================
// Google Translate (免费，无需 API Key)
// ============================================
async function googleTranslate(word, timeoutMs, sourceLang = 'en', targetLang = 'zh-CN') {
  const url = `${GOOGLE_TRANSLATE_API}?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(word)}`;

  const result = await Promise.race([
    fetch(url).then(r => r.json()),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  const translation = result?.[0]?.[0]?.[0] || '';

  // 如果翻译结果和原文一样，说明没有翻译成功
  if (translation.toLowerCase() === word) return '';

  return translation;
}

// ============================================
// 通义千问 Qwen 翻译
// ============================================
// 根据语言对生成翻译 prompt
function buildTranslatePrompt(word, sourceLang = 'en', targetLang = 'zh-CN') {
  const langNames = {
    'en': 'English', 'zh-CN': '中文', 'ja': '日本語',
    'ko': '한국어', 'fr': 'Français', 'es': 'Español', 'de': 'Deutsch'
  };
  const srcName = langNames[sourceLang] || sourceLang;
  const tgtName = langNames[targetLang] || targetLang;
  return `Translate the following ${srcName} word/phrase into a concise ${tgtName} translation (output only the translation, max 10 words): ${word}`;
}

async function qwenTranslate(word, config, timeoutMs, sourceLang, targetLang) {
  const { apiKey } = config;
  if (!apiKey) throw new Error('通义千问未配置 API Key');

  const response = await Promise.race([
    fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        messages: [{
          role: 'user',
          content: buildTranslatePrompt(word, sourceLang, targetLang)
        }]
      })
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================
// 豆包翻译
// ============================================
async function doubaoTranslate(word, config, timeoutMs, sourceLang, targetLang) {
  const { accessToken } = config;
  if (!accessToken) throw new Error('豆包未配置 Access Token');

  const response = await Promise.race([
    fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'doubao-lite-32k',
        messages: [{
          role: 'user',
          content: buildTranslatePrompt(word, sourceLang, targetLang)
        }]
      })
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================
// MiniMax 翻译
// ============================================
async function minimaxTranslate(word, config, timeoutMs, sourceLang, targetLang) {
  const { apiKey } = config;
  if (!apiKey) throw new Error('MiniMax 未配置 API Key');

  const response = await Promise.race([
    fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: [{
          role: 'user',
          content: buildTranslatePrompt(word, sourceLang, targetLang)
        }]
      })
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================
// 翻译服务商适配器
// ============================================
const translationProviders = {
  google: googleTranslate,
  qwen: qwenTranslate,
  doubao: doubaoTranslate,
  minimax: minimaxTranslate
};

// ============================================
// 从 Free Dictionary definitions 提取简洁释义
// ============================================
export function getDefinitionSummary(definitions) {
  if (!definitions || definitions.length === 0) return '';

  // 取第一个释义的 meaning 字段，控制在 30 字以内
  const firstDef = definitions[0]?.meaning;
  if (!firstDef) return '';
  if (firstDef.length <= 30) return firstDef;

  // 截断到句号或逗号，避免截断单词
  const cutIndex = firstDef.substring(0, 30).lastIndexOf(' ');
  return cutIndex > 0 ? firstDef.substring(0, cutIndex) + '...' : firstDef.substring(0, 30) + '...';
}

// ============================================
// 翻译主函数
// ============================================
export async function translateWord(word, provider = 'google', config = {}, timeoutMs = 3000, sourceLang = 'en', targetLang = 'zh-CN') {
  if (!word) return '';

  const cleanWord = word.trim().toLowerCase();
  const cacheKey = `${sourceLang}:${targetLang}:${cleanWord}`;

  // 查缓存
  if (translateCache.has(cacheKey)) {
    return translateCache.get(cacheKey);
  }

  // 尝试选中的翻译服务商
  try {
    const translateFn = translationProviders[provider];
    if (!translateFn) throw new Error(`不支持的翻译服务商: ${provider}`);

    const translation = provider === 'google'
      ? await translateFn(cleanWord, timeoutMs, sourceLang, targetLang)
      : await translateFn(cleanWord, config, timeoutMs, sourceLang, targetLang);

    if (translation) {
      if (translateCache.size >= MAX_CACHE_SIZE) {
        const firstKey = translateCache.keys().next().value;
        translateCache.delete(firstKey);
      }
      translateCache.set(cacheKey, translation);
      saveCache(); // 持久化缓存
      return translation;
    }
  } catch (error) {
    console.warn(`翻译服务商 [${provider}] 失败:`, error.message);
  }

  // 降级到 Google Translate（如果主服务商不是 Google）
  if (provider !== 'google') {
    try {
      const translation = await googleTranslate(cleanWord, timeoutMs, sourceLang, targetLang);
      if (translation) {
        if (translateCache.size >= MAX_CACHE_SIZE) {
          const firstKey = translateCache.keys().next().value;
          translateCache.delete(firstKey);
        }
        translateCache.set(cacheKey, translation);
        saveCache();
        return translation;
      }
    } catch (error) {
      console.warn('Google Translate 降级失败:', error.message);
    }
  }

  // 所有翻译服务都失败，尝试用 Free Dictionary 英文释义兜底
  try {
    const dictResp = await Promise.race([
      fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
    if (dictResp.ok) {
      const data = await dictResp.json();
      const firstDef = data?.[0]?.meanings?.[0]?.definitions?.[0]?.definition;
      if (firstDef) {
        const fallback = firstDef.length > 40 ? firstDef.substring(0, 40) + '...' : firstDef;
        translateCache.set(cacheKey, fallback);
        saveCache();
        return fallback;
      }
    }
  } catch (e) {
    // Free Dictionary 也失败，放弃
  }

  return '';
}

export default { translateWord, getDefinitionSummary };
