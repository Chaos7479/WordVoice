import { getSettings } from './settings.js';
import { getProviderAudio } from './tts-providers.js';
import { fetchWordData } from './lookup.js';
import { normalizeText, getTextType } from './text.js';
import { request, base64, throwIfAborted } from './network.js';
import db from './db.js';
import { selectBrowserVoice, voiceLanguage } from './voices.js';

const NAMES = {
  'chrome-tts': '浏览器语音',
  'free-dict': '词典原音',
  dashscope: '阿里云百炼',
  doubao: '豆包',
  minimax: 'MiniMax',
};
let active;
let creating;
let voicePromise;
const offscreenUrl = () => chrome.runtime.getURL('offscreen/offscreen.html');
async function hasOffscreen() {
  return (
    (
      await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl()],
      })
    ).length > 0
  );
}
async function ensureOffscreen() {
  if (!creating)
    creating = (async () => {
      if (!(await hasOffscreen()))
        await chrome.offscreen.createDocument({
          url: 'offscreen/offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: '在扩展中稳定播放选中文本的发音',
        });
    })().finally(() => {
      creating = null;
    });
  return creating;
}
async function stopAudio(signal) {
  const exists = await hasOffscreen();
  throwIfAborted(signal);
  if (exists)
    await chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop' }).catch(() => {});
}
export async function stopSpeech() {
  active?.abort(new DOMException('已停止朗读', 'AbortError'));
  const controller = new AbortController();
  active = controller;
  chrome.tts.stop();
  await stopAudio(controller.signal);
}
export function getVoices(refresh = false) {
  if (refresh) voicePromise = null;
  if (!voicePromise)
    voicePromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        voicePromise = null;
        resolve([]);
      }, 800);
      chrome.tts.getVoices((voices) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !voices?.length) voicePromise = null;
        resolve(voices || []);
      });
    });
  return voicePromise;
}
chrome.tts.onVoicesChanged?.addListener(() => {
  voicePromise = null;
});
export async function chromeTTS(text, settings, signal) {
  const lang = voiceLanguage(settings);
  const voices = await getVoices();
  throwIfAborted(signal);
  const voice = selectBrowserVoice(voices, settings);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(voice?.voiceName || '系统默认音色');
    };
    const abort = () => finish(signal.reason || new DOMException('已停止朗读', 'AbortError'));
    const timer = setTimeout(() => {
      chrome.tts.stop();
      finish(new Error('浏览器语音启动超时，请检查系统语音设置'));
    }, 4000);
    signal?.addEventListener('abort', abort, { once: true });
    const options = {
      lang,
      rate: settings.speechRate,
      pitch: 1,
      enqueue: false,
      onEvent(event) {
        if (event.type === 'start' || event.type === 'end') finish();
        else if (event.type === 'error')
          finish(new Error(event.errorMessage || '浏览器语音不可用'));
        else if (event.type === 'interrupted' || event.type === 'cancelled')
          finish(new DOMException('已停止朗读', 'AbortError'));
      },
    };
    if (voice?.voiceName) options.voiceName = voice.voiceName;
    if (voice?.extensionId) options.extensionId = voice.extensionId;
    chrome.tts.speak(text, options, () => {
      if (chrome.runtime.lastError) finish(new Error(chrome.runtime.lastError.message));
      // Engines that explicitly advertise no start event acknowledge via callback.
      else if (voice?.eventTypes && !voice.eventTypes.includes('start')) finish();
    });
  });
}
async function audioDataUrl(url, signal) {
  if (url.startsWith('data:audio/')) {
    if (url.length > 6 * 1024 * 1024) throw new Error('音频过大，请缩短文本');
    return url;
  }
  const parsed = new URL(url);
  // Qwen-TTS returns signed OSS links with http:// even though those buckets
  // support HTTPS. Preserve the signature and require TLS for the download.
  if (
    parsed.protocol === 'http:' &&
    /^dashscope-result-[\w-]+\.oss-[\w-]+\.aliyuncs\.com$/.test(parsed.hostname) &&
    !parsed.port
  )
    parsed.protocol = 'https:';
  const allowed = [
    'dictionaryapi.dev',
    'gstatic.com',
    'aliyuncs.com',
    'minimax.chat',
    'minimaxi.com',
  ];
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !allowed.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
  )
    throw new Error('音频服务返回了未知地址');
  const bytes = await request(parsed.href, { signal, timeoutMs: 3000, format: 'buffer' });
  if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024)
    throw new Error('音频大小无效，请缩短文本');
  // Browsers detect MP3/WAV from their headers; a generic audio MIME also handles signed URLs.
  return `data:audio/mpeg;base64,${base64(bytes)}`;
}
async function playAudioUrl(url, settings, signal) {
  await ensureOffscreen();
  throwIfAborted(signal);
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => {
      chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop' }).catch(() => {});
      reject(signal.reason || new DOMException('已停止朗读', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  let response;
  try {
    response = await Promise.race([
      chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'play',
        url,
        rate: settings.speechRate,
      }),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
  throwIfAborted(signal);
  if (!response?.success) throw new Error(response?.error || '音频播放失败');
}
export async function audioCacheKey(text, provider, config, settings) {
  const descriptor = JSON.stringify([
    2,
    text,
    provider,
    config.model,
    config.voice,
    config.voiceId,
    config.voiceType,
    config.cluster,
    settings.pronunciation,
    settings.sourceLanguage,
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(descriptor));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function logSpeech(text, source, elapsedMs) {
  const { ttsLog = [] } = await chrome.storage.session.get('ttsLog');
  ttsLog.unshift({
    text: text.slice(0, 50),
    source: source.label,
    degraded: source.degraded,
    time: new Date().toLocaleTimeString(),
    elapsedMs,
  });
  await chrome.storage.session.set({ ttsLog: ttsLog.slice(0, 20) });
}
export async function getTtsLog() {
  return (await chrome.storage.session.get('ttsLog')).ttsLog || [];
}
export async function getConsecutiveDegradations() {
  const log = await getTtsLog();
  let n = 0;
  for (const entry of log) {
    if (!entry.degraded) break;
    n++;
  }
  return n;
}

// One global playback slot. Every newer request cancels pending synthesis and the old voice.
export async function speak(value, override, { strict = false } = {}) {
  const text = normalizeText(value);
  active?.abort(new DOMException('已切换到新选区', 'AbortError'));
  const controller = new AbortController();
  active = controller;
  const signal = controller.signal;
  chrome.tts.stop();
  const started = performance.now();
  const stopped = stopAudio(signal);
  // Attach immediately: a newer request can cancel this while settings are loading.
  stopped.catch(() => {});
  const settings = await (override || getSettings());
  await stopped;
  throwIfAborted(signal);
  const provider = settings.ttsProvider;
  const config = settings.providers[provider] || {};
  let actual = provider;
  let fallbackReason = '';
  let browserVoice = '';
  try {
    if (provider === 'chrome-tts' || (provider === 'free-dict' && getTextType(text) !== 'word')) {
      actual = 'chrome-tts';
      browserVoice = await chromeTTS(text, settings, signal);
    } else {
      // Cap the whole cloud path, including synthesis, download and player startup.
      const deadline = new AbortController();
      const abort = () => deadline.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => deadline.abort(new Error('云端发音超过 5 秒，已切换浏览器语音')),
        5000,
      );
      try {
        const key = await audioCacheKey(text, provider, config, settings);
        const cached = await db.getAudioCache(key).catch(() => null);
        throwIfAborted(deadline.signal);
        let url = cached ? `data:${cached.mimeType};base64,${cached.audioData}` : '';
        if (!url) {
          const remote =
            provider === 'free-dict'
              ? (await fetchWordData(text, settings.pronunciation)).audioUrl
              : await getProviderAudio(
                  provider,
                  config,
                  text,
                  deadline.signal,
                  settings.sourceLanguage,
                );
          throwIfAborted(deadline.signal);
          if (!remote) throw new Error('词典暂未提供原音');
          url = await audioDataUrl(remote, deadline.signal);
        }
        throwIfAborted(deadline.signal);
        await playAudioUrl(url, settings, deadline.signal);
        if (!cached) {
          const match = /^data:([^;]+);base64,(.+)$/.exec(url);
          if (match) await db.saveAudioCache(key, match[2], match[1]).catch(() => {});
        }
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }
  } catch (error) {
    throwIfAborted(signal);
    if (strict || provider === 'chrome-tts') throw error;
    fallbackReason = error.message;
    await stopAudio(signal);
    throwIfAborted(signal);
    actual = 'chrome-tts';
    browserVoice = await chromeTTS(text, settings, signal);
  }
  throwIfAborted(signal);
  const source = {
    provider: actual,
    label: `${NAMES[actual] || actual}${browserVoice ? ` · ${browserVoice}` : ''}`,
    voice: browserVoice,
    degraded: !!fallbackReason,
  };
  await logSpeech(text, source, Math.round(performance.now() - started)).catch(() => {});
  return { ttsSource: source, fallbackReason };
}
export { fetchWordData };
export default {
  pronounce: speak,
  speakSentence: speak,
  speak,
  stopSpeech,
  getTtsLog,
  getConsecutiveDegradations,
};
