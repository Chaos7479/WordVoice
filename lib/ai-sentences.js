// WordVoice AI 例句生成模块

const SENTENCE_CACHE_KEY = 'wordvoice_sentence_cache';
const MAX_CACHE_SIZE = 500;
const sentenceCache = new Map();

// 启动时从 storage 加载缓存
(async function loadCache() {
  try {
    const result = await chrome.storage.local.get(SENTENCE_CACHE_KEY);
    if (result[SENTENCE_CACHE_KEY]) {
      const entries = Object.entries(result[SENTENCE_CACHE_KEY]);
      entries.forEach(([word, sentences]) => {
        sentenceCache.set(word, sentences);
      });
    }
  } catch (error) {
    console.error('加载例句缓存失败:', error);
  }
})();

// 持久化缓存
async function saveCache() {
  try {
    const cacheObj = Object.fromEntries(sentenceCache);
    await chrome.storage.local.set({ [SENTENCE_CACHE_KEY]: cacheObj });
  } catch (error) {
    console.error('保存例句缓存失败:', error);
  }
}

const SENTENCE_PROMPT = (word) =>
  `Generate 3 short English example sentences using the word "${word}". Each sentence should demonstrate a different common usage or meaning. Format: one sentence per line, numbered 1-3. Only output the sentences, no explanations.`;

// ============================================
// 通义千问 Qwen
// ============================================
async function qwenGenerate(word, config, timeoutMs) {
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
        messages: [{ role: 'user', content: SENTENCE_PROMPT(word) }]
      })
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  if (!response.ok) throw new Error(`Qwen API 错误: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================
// 豆包
// ============================================
async function doubaoGenerate(word, config, timeoutMs) {
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
        messages: [{ role: 'user', content: SENTENCE_PROMPT(word) }]
      })
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  if (!response.ok) throw new Error(`豆包 API 错误: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================
// MiniMax
// ============================================
async function minimaxGenerate(word, config, timeoutMs) {
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
        messages: [{ role: 'user', content: SENTENCE_PROMPT(word) }]
      })
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  if (!response.ok) throw new Error(`MiniMax API 错误: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================
// 服务商适配器
// ============================================
const sentenceProviders = {
  qwen: qwenGenerate,
  doubao: doubaoGenerate,
  minimax: minimaxGenerate
};

// 解析 AI 返回的例句文本为数组
function parseSentences(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(line => line.length > 0 && line.length < 300);
}

// ============================================
// 主函数：生成 AI 例句
// ============================================
export async function generateSentences(word, provider = 'qwen', config = {}, timeoutMs = 8000) {
  if (!word) return [];

  const cleanWord = word.trim().toLowerCase();

  // 查缓存
  if (sentenceCache.has(cleanWord)) {
    return sentenceCache.get(cleanWord);
  }

  // 需要 AI 服务商的 API Key
  const generateFn = sentenceProviders[provider];
  if (!generateFn) {
    throw new Error(`不支持的 AI 服务商: ${provider}。请在设置中配置通义千问/豆包/MiniMax 的 API Key`);
  }

  const rawText = await generateFn(cleanWord, config, timeoutMs);
  const sentences = parseSentences(rawText);

  if (sentences.length > 0) {
    // LRU: 超过上限时删除最早的条目
    if (sentenceCache.size >= MAX_CACHE_SIZE) {
      const firstKey = sentenceCache.keys().next().value;
      sentenceCache.delete(firstKey);
    }
    sentenceCache.set(cleanWord, sentences);
    saveCache();
  }

  return sentences;
}

export default { generateSentences };
