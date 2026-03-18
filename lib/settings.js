// WordVoice 设置管理

export const LANGUAGES = [
  { code: 'en', name: 'English', nameZh: '英语' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nameZh: '简体中文' },
  { code: 'ja', name: 'Japanese', nameZh: '日语' },
  { code: 'ko', name: 'Korean', nameZh: '韩语' },
  { code: 'fr', name: 'French', nameZh: '法语' },
  { code: 'es', name: 'Spanish', nameZh: '西班牙语' },
  { code: 'de', name: 'German', nameZh: '德语' }
];

const DEFAULTS = {
  ttsProvider: 'free-dict',
  translationProvider: 'google',
  aiProvider: 'qwen',
  pronunciation: 'us',
  showTranslation: true,
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  providers: {
    doubao: { appId: '', accessToken: '', cluster: 'volcano_tts', voiceType: 'BV056_streaming' },
    dashscope: { apiKey: '', model: 'qwen3-tts-flash', voice: 'Ethan' },
    minimax: { groupId: '', apiKey: '', voiceId: 'English_expressive_narrator_v2', model: 'speech-01-turbo' },
    qwen: { apiKey: '' }
  }
};

// 合并 provider 配置：用户值为空时保留默认值
function mergeProvider(defaults, saved) {
  if (!saved) return { ...defaults };
  const merged = { ...defaults };
  for (const [key, val] of Object.entries(saved)) {
    if (val !== '' && val !== undefined && val !== null) {
      merged[key] = val;
    }
  }
  return merged;
}

export async function getSettings() {
  try {
    const result = await chrome.storage.sync.get('settings');
    if (!result.settings) return { ...DEFAULTS };
    return {
      ...DEFAULTS,
      ...result.settings,
      providers: {
        doubao: mergeProvider(DEFAULTS.providers.doubao, result.settings.providers?.doubao),
        dashscope: mergeProvider(DEFAULTS.providers.dashscope, result.settings.providers?.dashscope),
        minimax: mergeProvider(DEFAULTS.providers.minimax, result.settings.providers?.minimax),
        qwen: mergeProvider(DEFAULTS.providers.qwen, result.settings.providers?.qwen)
      }
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

export const PROVIDER_LIST = [
  { id: 'free-dict', name: 'Free Dictionary (默认)', needsKey: false },
  { id: 'dashscope', name: '阿里云百炼 (DashScope)', needsKey: true },
  { id: 'doubao', name: '豆包 (火山引擎)', needsKey: true },
  { id: 'minimax', name: 'MiniMax', needsKey: true }
];

export const TRANSLATION_PROVIDER_LIST = [
  { id: 'google', name: 'Google Translate (免费)', needsKey: false },
  { id: 'qwen', name: '通义千问 (Qwen)', needsKey: true },
  { id: 'doubao', name: '豆包', needsKey: true },
  { id: 'minimax', name: 'MiniMax', needsKey: true }
];

export const AI_PROVIDER_LIST = [
  { id: 'qwen', name: '通义千问 (Qwen)', needsKey: true, keyField: 'apiKey', hint: '在阿里云 DashScope 控制台获取' },
  { id: 'doubao', name: '豆包', needsKey: true, keyField: 'accessToken', hint: '使用火山引擎 Access Token' },
  { id: 'minimax', name: 'MiniMax', needsKey: true, keyField: 'apiKey', hint: '在 MiniMax 控制台获取' }
];

export default { getSettings, saveSettings, PROVIDER_LIST, TRANSLATION_PROVIDER_LIST, AI_PROVIDER_LIST, LANGUAGES };
