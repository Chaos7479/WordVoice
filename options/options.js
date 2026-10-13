import {
  getSettings,
  saveSettings,
  DEFAULTS,
  LANGUAGES,
  PROVIDER_LIST,
  TRANSLATION_PROVIDER_LIST,
  AI_PROVIDER_LIST,
  importLocalCredentials,
  importCredentialData,
} from '../lib/settings.js';
import { send, escapeHtml as esc, showStatus } from '../lib/ui.js';
import db from '../lib/db.js';
import { compatibleVoices, selectBrowserVoice, isCharacterVoice } from '../lib/voices.js';
const $ = (id) => document.getElementById(id);
const fields = {
  dashscope: {
    title: '阿里云百炼 · 语音',
    hint: '使用中国内地百炼 API Key。Qwen3-TTS 每次最多 600 个字符。更长文本自动使用浏览器语音。',
    fields: [
      ['apiKey', 'API Key', 'password'],
      ['model', '语音模型', ['qwen3-tts-flash']],
      ['voice', '音色', ['Ethan', 'Jennifer', 'Aiden', 'Cherry', 'Serena', 'Chelsie']],
    ],
  },
  qwen: {
    title: '通义千问 · 翻译、解释和例句',
    hint: '翻译、浮层解释和 AI 例句共用此配置。Key 留空时使用百炼语音的 Key。',
    fields: [
      ['apiKey', 'API Key', 'password'],
      ['textModel', '文本模型名称', 'text'],
    ],
  },
  doubao: {
    title: '豆包 · 语音与方舟文本',
    hint: '语音服务使用 App ID 和 Access Token。翻译、解释和例句使用方舟 API Key 与已开通的模型 ID。',
    fields: [
      ['appId', '语音 App ID', 'text'],
      ['accessToken', '语音 Access Token', 'password'],
      ['voiceType', '语音音色 ID', 'text'],
      ['apiKey', '方舟 API Key（翻译、解释和例句）', 'password'],
      ['textModel', '方舟模型名称或推理接入点 ID', 'text'],
    ],
  },
  minimax: {
    title: 'MiniMax · 语音、翻译、解释和例句',
    hint: '使用中国内地平台凭据。Group ID 按账户配置填写。',
    fields: [
      ['apiKey', 'API Key', 'password'],
      ['groupId', 'Group ID（可选）', 'text'],
      ['model', '语音模型名称', 'text'],
      ['voiceId', '语音音色 ID', 'text'],
      ['textModel', '文本模型名称', 'text'],
    ],
  },
};
let loadedSettings;
let dirty = false;
let browserVoices = [];
function renderBrowserVoices(selected = $('browserVoice').value) {
  const preferences = {
    sourceLanguage: $('sourceLanguage').value,
    pronunciation: $('pronunciation').value,
  };
  const voices = compatibleVoices(browserVoices, preferences);
  const automatic = selectBrowserVoice(browserVoices, preferences);
  const select = $('browserVoice');
  select.replaceChildren(
    new Option(`自动选择${automatic ? ` · ${automatic.voiceName}` : '朗读音色'}`, ''),
  );
  for (const voice of voices)
    select.add(
      new Option(
        `${voice.voiceName} · ${voice.lang} · ${voice.remote ? '联网' : '本地'}${isCharacterVoice(voice) ? ' · 特殊音效' : ''}`,
        voice.voiceName,
      ),
    );
  const missing = selected && !voices.some((voice) => voice.voiceName === selected);
  if (missing) select.add(new Option(`${selected}（当前不可用）`, selected));
  select.value = selected;
  $('browserVoiceHint').textContent = missing
    ? '已保存的音色当前不可用，朗读时自动选择。可重新选择并保存。'
    : automatic
      ? `自动模式优先使用普通朗读音色：${automatic.voiceName}。`
      : '当前未找到普通朗读音色，将使用系统默认音色。可在系统语音设置中添加音色后刷新。';
}
async function refreshVoices(selected = $('browserVoice').value) {
  $('refreshVoices').disabled = true;
  try {
    const result = await send('getBrowserVoices');
    if (result.error) throw new Error(result.error);
    browserVoices = result.voices || [];
    renderBrowserVoices(selected);
  } catch (error) {
    $('browserVoiceHint').textContent = `音色列表暂不可用：${error.message}`;
  } finally {
    $('refreshVoices').disabled = false;
  }
}
$('refreshVoices').onclick = () => refreshVoices();
for (const id of ['sourceLanguage', 'pronunciation'])
  $(id).addEventListener('change', () => renderBrowserVoices(''));
function renderFields(settings) {
  $('providerFields').innerHTML = Object.entries(fields)
    .map(
      ([provider, spec]) =>
        `<details class="credential-section" data-provider="${provider}" ${provider === settings.ttsProvider || provider === settings.translationProvider || provider === settings.aiProvider ? 'open' : ''}><summary>${spec.title}</summary><p class="hint">${spec.hint}</p>${spec.fields
          .map(([key, label, type]) => {
            const id = `${provider}-${key}`;
            return `<div class="field"><label for="${id}">${label}</label>${
              Array.isArray(type)
                ? `<select id="${id}">${[...new Set([...type, settings.providers[provider][key]])]
                    .filter(Boolean)
                    .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
                    .join('')}</select>`
                : `<div class="password-field"><input id="${id}" type="${type}" autocomplete="off" spellcheck="false" maxlength="4096">${type === 'password' ? `<button type="button" class="toggle-btn" data-target="${id}">显示</button>` : ''}</div>`
            }</div>`;
          })
          .join('')}</details>`,
    )
    .join('');
  for (const [provider, spec] of Object.entries(fields))
    for (const [key] of spec.fields)
      $(`${provider}-${key}`).value = settings.providers[provider][key];
  document.querySelectorAll('.toggle-btn').forEach((button) => {
    button.onclick = () => {
      const input = $(button.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? '显示' : '隐藏';
    };
  });
}
function collect() {
  const settings = structuredClone(loadedSettings || DEFAULTS);
  for (const key of [
    'ttsProvider',
    'translationProvider',
    'aiProvider',
    'pronunciation',
    'sourceLanguage',
    'targetLanguage',
    'browserVoice',
  ])
    settings[key] = $(key).value;
  settings.speechRate = Number($('speechRate').value);
  settings.showTranslation = $('showTranslation').checked;
  for (const [provider, spec] of Object.entries(fields))
    for (const [key] of spec.fields)
      settings.providers[provider][key] = $(`${provider}-${key}`).value.trim();
  return settings;
}
async function load() {
  try {
    await importLocalCredentials();
    const settings = await getSettings();
    loadedSettings = settings;
    for (const [id, list] of [
      ['ttsProvider', PROVIDER_LIST],
      ['translationProvider', TRANSLATION_PROVIDER_LIST],
      ['aiProvider', AI_PROVIDER_LIST],
    ])
      $(id).innerHTML = list.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    for (const id of ['sourceLanguage', 'targetLanguage'])
      $(id).innerHTML = LANGUAGES.map(
        (l) => `<option value="${l.code}">${l.nameZh} (${l.name})</option>`,
      ).join('');
    for (const key of [
      'ttsProvider',
      'translationProvider',
      'aiProvider',
      'pronunciation',
      'sourceLanguage',
      'targetLanguage',
    ])
      $(key).value = settings[key];
    if (![...$('speechRate').options].some((o) => Number(o.value) === settings.speechRate))
      $('speechRate').add(new Option(`${settings.speechRate}×`, settings.speechRate));
    $('speechRate').value = String(settings.speechRate);
    $('showTranslation').checked = settings.showTranslation;
    renderFields(settings);
    // Retain a saved choice even if voice discovery is temporarily unavailable.
    renderBrowserVoices(settings.browserVoice);
    await refreshVoices(settings.browserVoice);
    $('saveBtn').disabled = false;
    $('importCredentials').disabled = false;
    $('settingsForm').oninput = (event) => {
      if (event.target === $('credentialFile')) return;
      dirty = true;
      $('saveStatus').dataset.dirty = 'true';
      $('saveStatus').textContent = '有未保存的更改';
      $('saveStatus').classList.add('show');
    };
    await refreshDiagnostics();
  } catch (error) {
    showStatus(error.message, true);
  }
}
for (const id of ['ttsProvider', 'translationProvider', 'aiProvider']) {
  $(id).addEventListener('change', () => {
    const section = document.querySelector(`.credential-section[data-provider="${$(id).value}"]`);
    if (section) section.open = true;
  });
}
$('settingsForm').onsubmit = async (event) => {
  event.preventDefault();
  if (!loadedSettings) return;
  $('saveBtn').disabled = true;
  try {
    loadedSettings = collect();
    await saveSettings(loadedSettings);
    dirty = false;
    $('saveStatus').dataset.dirty = 'false';
    $('saveStatus').textContent = '已保存';
    $('saveStatus').classList.add('show');
    showStatus('设置已保存');
    await refreshDiagnostics();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    $('saveBtn').disabled = false;
  }
};
$('importCredentials').onclick = () => $('credentialFile').click();
$('credentialFile').onchange = async () => {
  const file = $('credentialFile').files[0];
  if (!file || !loadedSettings) return;
  const status = $('credentialImportStatus');
  $('importCredentials').disabled = true;
  $('saveBtn').disabled = true;
  try {
    if (file.size > 128 * 1024) throw new Error('配置文件超过 128 KB，请选择 settings.local.json');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      // Parser errors may include fragments of a secret. Show a fixed message.
      throw new Error('配置文件格式无效，请选择有效的 JSON 文件');
    }
    const result = await importCredentialData(data, collect());
    loadedSettings = result.settings;
    renderFields(loadedSettings);
    dirty = false;
    $('saveStatus').dataset.dirty = 'false';
    $('saveStatus').textContent = '已保存';
    status.dataset.error = 'false';
    status.textContent = `已导入并保存：${result.imported.map((id) => fields[id].title.split(' · ')[0]).join('、')}。可返回浮层选择发音。`;
    await refreshDiagnostics();
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message;
  } finally {
    status.hidden = false;
    $('credentialFile').value = '';
    $('importCredentials').disabled = false;
    $('saveBtn').disabled = false;
  }
};
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
let testing = false;
async function test(type) {
  if (!loadedSettings || testing) return;
  testing = true;
  document.querySelectorAll('#testTts, #testTranslation, #testAi').forEach((b) => {
    b.disabled = true;
  });
  const settings = collect();
  const provider =
    settings[type === 'tts' ? 'ttsProvider' : type === 'ai' ? 'aiProvider' : 'translationProvider'];
  const log = $('testLog');
  $(type === 'tts' ? 'testTts' : type === 'ai' ? 'testAi' : 'testTranslation').parentElement.append(
    log,
  );
  log.classList.add('visible');
  log.textContent = '正在连接并准备结果…';
  log.dataset.state = 'loading';
  log.setAttribute('aria-busy', 'true');
  const started = performance.now();
  try {
    const result = await send('testApi', {
      type,
      provider,
      config: settings.providers[provider] || {},
      preferences: settings,
    });
    if (result.error) throw new Error(result.error);
    log.dataset.state = 'success';
    log.textContent = `成功 · ${Math.round(performance.now() - started)} ms\n${result.result}`;
  } catch (error) {
    log.dataset.state = 'error';
    log.textContent = `测试失败：${error.message}`;
  } finally {
    testing = false;
    log.removeAttribute('aria-busy');
    document.querySelectorAll('#testTts, #testTranslation, #testAi').forEach((b) => {
      b.disabled = false;
    });
    refreshDiagnostics();
  }
}
$('testTts').onclick = () => test('tts');
$('testTranslation').onclick = () => test('translation');
$('testAi').onclick = () => test('ai');
$('stopSpeech').onclick = () =>
  send('stopSpeech').catch((error) => showStatus(error.message, true));
async function refreshDiagnostics() {
  try {
    const [status, result, cache] = await Promise.all([
      send('getTtsStatus'),
      send('getTtsLog'),
      db.getAudioCacheStats(),
    ]);
    $('ttsStatus').textContent =
      `已保存的发音服务：${status.providerName} · ${status.configured ? '已配置' : '请填写凭据'}`;
    $('ttsLogContainer').innerHTML = result.log.length
      ? `<table class="tts-log-table"><thead><tr><th>时间</th><th>文本</th><th>来源</th><th>启动耗时</th></tr></thead><tbody>${result.log.map((entry) => `<tr><td>${esc(entry.time)}</td><td>${esc(entry.text)}</td><td>${esc(entry.source)}${entry.degraded ? '（备用）' : ''}</td><td>${Number(entry.elapsedMs)} ms</td></tr>`).join('')}</tbody></table>`
      : '<p class="hint">使用朗读后，这里会显示记录。</p>';
    $('cacheCount').textContent = cache.count;
    $('cacheSize').textContent = cache.estimatedSizeKB;
  } catch (error) {
    showStatus(error.message, true);
  }
}
$('refreshLogBtn').onclick = refreshDiagnostics;
$('clearCacheBtn').onclick = async () => {
  $('clearCacheBtn').disabled = true;
  try {
    await db.clearAudioCache();
    await refreshDiagnostics();
    showStatus('音频缓存已清除');
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    $('clearCacheBtn').disabled = false;
  }
};
$('openShortcuts').onclick = (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
};
async function refreshFileAccess() {
  try {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    $('fileAccessStatus').textContent = allowed
      ? '已允许访问本地网页。刷新 HTML 页面后，选中文字按 S 朗读。'
      : '在扩展详情中开启「允许访问文件网址」，再刷新本地 HTML 页面。授权后可在本地网页选词朗读。';
  } catch {
    $('fileAccessStatus').textContent = '请在扩展详情中查看「允许访问文件网址」。';
  }
}
$('openFileAccess').onclick = () =>
  chrome.tabs
    .create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
    .catch((error) => showStatus(error.message, true));
window.addEventListener('focus', refreshFileAccess);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshFileAccess();
});
refreshFileAccess();
const navLinks = [...document.querySelectorAll('.settings-sidebar nav a')];
const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    navLinks.forEach((link) => {
      const active = link.hash === `#${visible.target.id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  },
  { rootMargin: '-10% 0px -65% 0px', threshold: 0 },
);
document.querySelectorAll('section[id]').forEach((section) => observer.observe(section));
load();
