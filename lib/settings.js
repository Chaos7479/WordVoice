// Preferences and credentials stay in this browser profile. Upgrade once from v1 sync storage.
export const LANGUAGES = [
  { code: 'en', name: 'English', nameZh: '英语' },
  { code: 'zh-CN', name: 'Chinese', nameZh: '简体中文' },
  { code: 'ja', name: 'Japanese', nameZh: '日语' },
  { code: 'ko', name: 'Korean', nameZh: '韩语' },
  { code: 'fr', name: 'French', nameZh: '法语' },
  { code: 'es', name: 'Spanish', nameZh: '西班牙语' },
  { code: 'de', name: 'German', nameZh: '德语' },
];
export const DEFAULTS = {
  ttsProvider: 'chrome-tts',
  translationProvider: 'google',
  aiProvider: 'qwen',
  pronunciation: 'us',
  speechRate: 1,
  browserVoice: '',
  showTranslation: true,
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
  providers: {
    doubao: {
      appId: '',
      accessToken: '',
      apiKey: '',
      textModel: '',
      cluster: 'volcano_tts',
      voiceType: 'BV056_streaming',
    },
    dashscope: { apiKey: '', model: 'qwen3-tts-flash', voice: 'Ethan' },
    minimax: {
      groupId: '',
      apiKey: '',
      voiceId: 'English_expressive_narrator_v2',
      model: 'speech-02-turbo',
      textModel: 'MiniMax-M2.5',
    },
    qwen: { apiKey: '', textModel: 'qwen-turbo' },
  },
};
export const PROVIDER_LIST = [
  { id: 'chrome-tts', name: '浏览器语音（快速）', needsKey: false },
  { id: 'free-dict', name: '词典原音', needsKey: false },
  { id: 'dashscope', name: '阿里云百炼', needsKey: true },
  { id: 'doubao', name: '豆包 TTS', needsKey: true },
  { id: 'minimax', name: 'MiniMax', needsKey: true },
];
export const TRANSLATION_PROVIDER_LIST = [
  { id: 'google', name: 'Google Translate（免费）', needsKey: false },
  { id: 'qwen', name: '通义千问', needsKey: true },
  { id: 'doubao', name: '豆包（方舟）', needsKey: true },
  { id: 'minimax', name: 'MiniMax', needsKey: true },
];
export const AI_PROVIDER_LIST = TRANSLATION_PROVIDER_LIST.filter((p) => p.id !== 'google');

export function normalizeSettings(saved = {}) {
  const result = structuredClone(DEFAULTS);
  for (const key of ['ttsProvider', 'translationProvider', 'aiProvider']) {
    const list =
      key === 'ttsProvider'
        ? PROVIDER_LIST
        : key === 'aiProvider'
          ? AI_PROVIDER_LIST
          : TRANSLATION_PROVIDER_LIST;
    if (list.some((p) => p.id === saved[key])) result[key] = saved[key];
  }
  result.pronunciation = saved.pronunciation === 'uk' ? 'uk' : 'us';
  result.speechRate = Math.max(0.5, Math.min(2, Number(saved.speechRate) || 1));
  if (typeof saved.browserVoice === 'string')
    result.browserVoice = saved.browserVoice.trim().slice(0, 256);
  result.showTranslation = saved.showTranslation !== false;
  for (const key of ['sourceLanguage', 'targetLanguage']) {
    if (LANGUAGES.some((l) => l.code === saved[key])) result[key] = saved[key];
  }
  for (const [provider, fields] of Object.entries(result.providers)) {
    for (const key of Object.keys(fields)) {
      const value = saved.providers?.[provider]?.[key];
      if (typeof value === 'string') fields[key] = value.trim().slice(0, 4096);
    }
  }
  // v1 offered models that its HTTP adapter could never use.
  if (/^(cosyvoice|sambert)/.test(result.providers.dashscope.model)) {
    result.providers.dashscope.model = DEFAULTS.providers.dashscope.model;
    result.providers.dashscope.voice = DEFAULTS.providers.dashscope.voice;
  }
  return result;
}

let loading;
export async function getSettings() {
  const local = await chrome.storage.local.get('settings');
  if (local.settings) return normalizeSettings(local.settings);
  if (!loading)
    loading = (async () => {
      const legacy = await chrome.storage.sync.get('settings');
      const settings = normalizeSettings(legacy.settings);
      // v1's "free-dict" option actually used browser speech. Preserve that behavior.
      if (legacy.settings?.ttsProvider === 'free-dict') settings.ttsProvider = 'chrome-tts';
      // A settings page may have saved while sync storage was being read.
      const latest = await chrome.storage.local.get('settings');
      if (latest.settings) return normalizeSettings(latest.settings);
      await chrome.storage.local.set({ settings });
      if (legacy.settings) await chrome.storage.sync.remove('settings');
      return settings;
    })().finally(() => {
      loading = null;
    });
  return structuredClone(await loading);
}
export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings: normalizeSettings(settings) });
  await chrome.storage.sync.remove('settings');
}
