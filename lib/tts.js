// WordVoice TTS 发音模块

import { getSettings } from './settings.js';
import { getProviderAudio } from './tts-providers.js';
import db from './db.js';

const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

// 词典数据内存缓存（避免重复 HTTP 请求）
const wordDataCache = new Map();
const WORD_CACHE_MAX = 500;

// === TTS 发音日志与降级追踪 ===
const ttsLog = [];
const TTS_LOG_MAX = 10;
let consecutiveDegradations = 0;

const PROVIDER_DISPLAY_NAMES = {
  'dashscope': 'DashScope',
  'doubao': '豆包',
  'minimax': 'MiniMax',
  'free-dict': 'Free Dictionary',
  'google-backup': 'Google',
  'chrome-tts': 'Chrome TTS'
};

function getVoiceName(provider, config) {
  if (provider === 'dashscope') return config?.voice || 'Ethan';
  if (provider === 'doubao') return config?.voiceType || 'BV056_streaming';
  if (provider === 'minimax') return config?.voiceId || 'English_expressive_narrator_v2';
  return '';
}

function makeTtsSource(providerId, config, degraded) {
  const displayName = PROVIDER_DISPLAY_NAMES[providerId] || providerId;
  const voice = getVoiceName(providerId, config);
  return {
    provider: providerId,
    displayName,
    voice,
    degraded: !!degraded,
    label: voice ? `${displayName} / ${voice}` : displayName
  };
}

function addTtsLogEntry(text, source, elapsedMs) {
  ttsLog.unshift({
    text: text.substring(0, 30),
    source: source.label,
    degraded: source.degraded,
    time: new Date().toLocaleTimeString(),
    elapsedMs
  });
  if (ttsLog.length > TTS_LOG_MAX) ttsLog.pop();
  if (source.degraded) {
    consecutiveDegradations++;
  } else {
    consecutiveDegradations = 0;
  }
}

export function getTtsLog() { return [...ttsLog]; }
export function getConsecutiveDegradations() { return consecutiveDegradations; }

// 获取单词发音和释义（带缓存）
export async function fetchWordData(word) {
  const cleanWord = word.trim().toLowerCase();

  // 命中缓存直接返回（~0ms）
  if (wordDataCache.has(cleanWord)) {
    return wordDataCache.get(cleanWord);
  }

  try {
    const response = await fetch(`${DICTIONARY_API}${encodeURIComponent(cleanWord)}`);

    if (!response.ok) {
      return { word: cleanWord, phonetic: '', definitions: [], audioUrl: '' };
    }

    const data = await response.json();
    const entry = data[0];

    // 提取音标
    let phonetic = entry.phonetic || '';
    if (!phonetic && entry.phonetics?.length > 0) {
      phonetic = entry.phonetics.find(p => p.text)?.text || '';
    }

    // 根据设置选择美式或英式发音
    let audioUrl = '';
    if (entry.phonetics?.length > 0) {
      const settings = await getSettings();
      const preferUs = settings.pronunciation !== 'uk';

      if (preferUs) {
        const usAudio = entry.phonetics.find(p => p.audio?.includes('-us'));
        const anyAudio = entry.phonetics.find(p => p.audio);
        audioUrl = usAudio?.audio || anyAudio?.audio || '';
      } else {
        const ukAudio = entry.phonetics.find(p => p.audio?.includes('-uk'));
        const anyAudio = entry.phonetics.find(p => p.audio);
        audioUrl = ukAudio?.audio || anyAudio?.audio || '';
      }
    }

    // 提取释义
    const definitions = [];
    if (entry.meanings) {
      for (const meaning of entry.meanings) {
        const partOfSpeech = meaning.partOfSpeech;
        for (const def of meaning.definitions.slice(0, 2)) {
          definitions.push({
            partOfSpeech,
            meaning: def.definition,
            example: def.example || ''
          });
        }
      }
    }

    const result = {
      word: cleanWord,
      phonetic,
      definitions: definitions.slice(0, 5),
      audioUrl
    };

    // 写入缓存（LRU 淘汰）
    if (wordDataCache.size >= WORD_CACHE_MAX) {
      const firstKey = wordDataCache.keys().next().value;
      wordDataCache.delete(firstKey);
    }
    wordDataCache.set(cleanWord, result);

    return result;
  } catch (error) {
    console.error('Failed to fetch word data:', error);
    return { word: cleanWord, phonetic: '', definitions: [], audioUrl: '' };
  }
}

// 播放音频：通过 active tab 的 content script 播放
export async function playAudioUrl(url) {
  if (!url) return false;

  try {
    // 准备播放的 URL（HTTP URL 需要先 fetch 转 data URL）
    let playUrl = url;
    let cacheKey = null;
    let audioBase64 = null;
    let mimeType = 'audio/mpeg';

    if (!url.startsWith('data:')) {
      cacheKey = url.substring(0, 200);
      // 检查本地缓存
      try {
        const cached = await db.getAudioCache(cacheKey);
        if (cached) {
          playUrl = `data:${cached.mimeType};base64,${cached.audioData}`;
        }
      } catch (e) { /* 缓存读取失败 */ }

      // 缓存未命中：fetch 音频数据转 data URL
      if (playUrl === url) {
        try {
          const audioResp = await fetch(url);
          if (audioResp.ok) {
            const contentType = audioResp.headers.get('content-type');
            if (contentType) mimeType = contentType.split(';')[0];
            const buffer = await audioResp.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            audioBase64 = btoa(binary);
            playUrl = `data:${mimeType};base64,${audioBase64}`;
          }
        } catch (e) { /* fetch 失败 */ }
      }
    }

    // 发送给 active tab 的 content script 播放
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'playAudioFallback',
        url: playUrl
      });
      if (response?.success) {
        if (cacheKey && audioBase64) db.saveAudioCache(cacheKey, audioBase64, mimeType).catch(() => {});
        return true;
      }
    }
  } catch (e) {
    console.warn('音频播放失败:', e.message);
  }

  return false;
}

// 使用 chrome.tts 发音
export async function chromeTTS(word) {
  const voices = await new Promise(resolve => chrome.tts.getVoices(resolve));

  const preferredVoices = [
    'Google US English',
    'Google UK English Female',
    'Microsoft Zira',
    'Samantha',
    'Alex',
  ];

  let selectedVoice = null;
  for (const preferred of preferredVoices) {
    const found = voices.find(v => v.voiceName?.includes(preferred) && v.lang?.startsWith('en'));
    if (found) {
      selectedVoice = found.voiceName;
      break;
    }
  }

  if (!selectedVoice) {
    const englishVoice = voices.find(v => v.lang?.startsWith('en'));
    selectedVoice = englishVoice?.voiceName;
  }

  return new Promise((resolve, reject) => {
    const options = {
      lang: 'en-US',
      rate: 0.9,
      pitch: 1.0,
      onEvent: (event) => {
        if (event.type === 'end') resolve(true);
        else if (event.type === 'error') reject(new Error(event.errorMessage));
      }
    };
    if (selectedVoice) options.voiceName = selectedVoice;
    chrome.tts.speak(word, options);
  });
}

// 尝试播放备用音频源
async function tryAlternativeAudio(word) {
  const cleanWord = word.toLowerCase().trim();
  const googleUrl = `https://ssl.gstatic.com/dictionary/static/sounds/20200429/${cleanWord}--_us_1.mp3`;
  return playAudioUrl(googleUrl);
}

// 发音主函数（优化：并行执行，减少延迟）
export async function pronounce(word) {
  const cleanWord = word.trim().toLowerCase();
  const settings = await getSettings();
  const startTime = Date.now();

  const useThirdPartyTTS = settings.ttsProvider && settings.ttsProvider !== 'free-dict';
  let ttsSource = null;

  if (useThirdPartyTTS) {
    // === 第三方 TTS 模式：发音和词典数据并行 ===
    const providerConfig = settings.providers[settings.ttsProvider];
    const ttsCacheKey = `${cleanWord.substring(0, 100)}__${settings.ttsProvider}__${settings.pronunciation || 'us'}`;

    // 词典数据在后台并行获取（不阻塞发音）
    const wordDataPromise = fetchWordData(cleanWord);

    // 1. 先检查 TTS 缓存（本地，~5ms）
    let played = false;
    try {
      const cached = await db.getAudioCache(ttsCacheKey);
      if (cached) {
        const cachedUrl = `data:${cached.mimeType};base64,${cached.audioData}`;
        played = await playAudioUrl(cachedUrl);
        if (played) ttsSource = makeTtsSource(settings.ttsProvider, providerConfig, false);
      }
    } catch (e) { /* 缓存读取失败 */ }

    // 2. 缓存未命中，调用 TTS API
    if (!played) {
      try {
        const audioUrl = await getProviderAudio(settings.ttsProvider, providerConfig, cleanWord);
        if (audioUrl) {
          played = await playAudioUrl(audioUrl);
          if (played) {
            ttsSource = makeTtsSource(settings.ttsProvider, providerConfig, false);
            if (audioUrl.startsWith('data:')) {
              const match = audioUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                db.saveAudioCache(ttsCacheKey, match[2], match[1]).catch(() => {});
              }
            }
          }
        }
      } catch (error) {
        console.warn(`TTS provider [${settings.ttsProvider}] failed:`, error.message);
      }
    }

    // 等待词典数据（此时大概率已经返回了）
    const wordData = await wordDataPromise;

    // 3. 第三方 TTS 失败，直接降级到 Chrome TTS
    if (!played) {
      try { await chromeTTS(cleanWord); ttsSource = makeTtsSource('chrome-tts', null, true); } catch (e) {}
    }

    if (!ttsSource) ttsSource = makeTtsSource('chrome-tts', null, true);
    addTtsLogEntry(cleanWord, ttsSource, Date.now() - startTime);

    return { ...wordData, ttsSource, degradationWarning: consecutiveDegradations >= 3 };

  } else {
    // === Free Dict 模式：获取词典数据 + Chrome TTS 发音 ===
    const wordData = await fetchWordData(cleanWord);

    try { await chromeTTS(cleanWord); } catch (e) {}
    ttsSource = makeTtsSource('chrome-tts', null, false);
    addTtsLogEntry(cleanWord, ttsSource, Date.now() - startTime);

    return { ...wordData, ttsSource, degradationWarning: false };
  }
}

// (Offscreen Document 已移除，音频通过 content script 播放)

// 朗读句子
export async function speakSentence(text) {
  const settings = await getSettings();
  const startTime = Date.now();
  let ttsSource = null;

  // 如果配置了第三方 TTS，也用于句子朗读
  if (settings.ttsProvider !== 'free-dict') {
    const providerConfig = settings.providers[settings.ttsProvider];
    try {
      const audioUrl = await getProviderAudio(settings.ttsProvider, providerConfig, text);
      if (audioUrl) {
        const success = await playAudioUrl(audioUrl);
        if (success) {
          ttsSource = makeTtsSource(settings.ttsProvider, providerConfig, false);
          addTtsLogEntry(text, ttsSource, Date.now() - startTime);
          return { ttsSource, degradationWarning: false };
        }
      }
    } catch (error) {
      console.warn('TTS provider failed for sentence, falling back to chrome.tts');
    }
  }

  await chromeTTS(text);
  const degraded = settings.ttsProvider !== 'free-dict';
  ttsSource = degraded ? makeTtsSource('chrome-tts', null, true) : makeTtsSource('free-dict', null, false);
  addTtsLogEntry(text, ttsSource, Date.now() - startTime);
  return { ttsSource, degradationWarning: consecutiveDegradations >= 3 };
}

export default {
  fetchWordData,
  playAudioUrl,
  chromeTTS,
  pronounce,
  speakSentence,
  getTtsLog,
  getConsecutiveDegradations
};
