// WordVoice 设置页面

import { getSettings, saveSettings, PROVIDER_LIST, TRANSLATION_PROVIDER_LIST, AI_PROVIDER_LIST, LANGUAGES } from '../lib/settings.js';
import db from '../lib/db.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 渲染语言下拉框
function renderLanguageSelectors(sourceLang, targetLang) {
  const sourceEl = $('#sourceLanguage');
  const targetEl = $('#targetLanguage');

  const buildOptions = (selected) => LANGUAGES.map(lang =>
    `<option value="${lang.code}" ${lang.code === selected ? 'selected' : ''}>${lang.nameZh} (${lang.name})</option>`
  ).join('');

  sourceEl.innerHTML = buildOptions(sourceLang);
  targetEl.innerHTML = buildOptions(targetLang);
}

// 渲染翻译服务商卡片
function renderTranslationProviderCards(currentProvider) {
  const container = $('#translationProviderCards');
  container.innerHTML = TRANSLATION_PROVIDER_LIST.map(provider => `
    <div class="provider-card ${currentProvider === provider.id ? 'active' : ''}" data-provider="${provider.id}">
      <div class="card-header">
        <h3>${provider.name}</h3>
        ${!provider.needsKey ? '<span class="badge free">免费</span>' : ''}
      </div>
      <div class="card-check">
        ${currentProvider === provider.id ? '✓' : ''}
      </div>
    </div>
  `).join('');

  // 卡片点击切换
  $$('#translationProviderCards .provider-card').forEach(card => {
    card.addEventListener('click', () => {
      const providerId = card.dataset.provider;
      $$('#translationProviderCards .provider-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      showTranslationProviderConfig(providerId);
    });
  });

  showTranslationProviderConfig(currentProvider);
}

// 渲染 TTS 服务商卡片
function renderTtsProviderCards(currentProvider) {
  const container = $('#ttsProviderCards');
  container.innerHTML = PROVIDER_LIST.map(provider => `
    <div class="provider-card ${currentProvider === provider.id ? 'active' : ''}" data-provider="${provider.id}">
      <div class="card-header">
        <h3>${provider.name}</h3>
      </div>
      <div class="card-check">
        ${currentProvider === provider.id ? '✓' : ''}
      </div>
    </div>
  `).join('');

  // 卡片点击切换 + 自动测试
  $$('#ttsProviderCards .provider-card').forEach(card => {
    card.addEventListener('click', () => {
      const providerId = card.dataset.provider;
      $$('#ttsProviderCards .provider-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      showTtsProviderConfig(providerId);
      autoTestTtsProvider(providerId);
    });
  });

  showTtsProviderConfig(currentProvider);
}

// 渲染 AI 服务商卡片
function renderAiProviderCards(currentProvider) {
  const container = $('#aiProviderCards');
  container.innerHTML = AI_PROVIDER_LIST.map(provider => `
    <div class="provider-card ${currentProvider === provider.id ? 'active' : ''}" data-provider="${provider.id}">
      <div class="card-header">
        <h3>${provider.name}</h3>
      </div>
      <div class="card-check">
        ${currentProvider === provider.id ? '✓' : ''}
      </div>
    </div>
  `).join('');

  // 卡片点击切换
  $$('#aiProviderCards .provider-card').forEach(card => {
    card.addEventListener('click', () => {
      const providerId = card.dataset.provider;
      $$('#aiProviderCards .provider-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      card.querySelector('.card-check').textContent = '✓';
      // 清除其他卡片的勾选
      $$('#aiProviderCards .provider-card:not(.active) .card-check').forEach(c => c.textContent = '');
      showAiProviderConfig(providerId);
    });
  });

  showAiProviderConfig(currentProvider);
}

function showAiProviderConfig(providerId) {
  $$('[id^="config-ai-"]').forEach(el => el.style.display = 'none');
  const configEl = $(`#config-ai-${providerId}`);
  if (configEl) configEl.style.display = 'block';
}

function showTranslationProviderConfig(providerId) {
  $$('[id^="config-translation-"]').forEach(el => el.style.display = 'none');
  const configEl = $(`#config-translation-${providerId}`);
  if (configEl) configEl.style.display = 'block';
}

function showTtsProviderConfig(providerId) {
  $$('[id^="config-"]:not([id^="config-translation-"]):not([id^="config-ai-"])')
    .forEach(el => el.classList.remove('active'));
  const configEl = $(`#config-${providerId}`);
  if (configEl) configEl.classList.add('active');
}

async function loadSettings() {
  const settings = await getSettings();

  // 口音
  const radioEl = $(`input[name="pronunciation"][value="${settings.pronunciation}"]`);
  if (radioEl) radioEl.checked = true;

  // 翻译
  $('#showTranslation').checked = settings.showTranslation;

  // 语言设置
  renderLanguageSelectors(settings.sourceLanguage || 'en', settings.targetLanguage || 'zh-CN');

  // 渲染翻译服务商卡片
  renderTranslationProviderCards(settings.translationProvider);

  // 渲染 AI 服务商卡片
  renderAiProviderCards(settings.aiProvider || 'qwen');

  // 渲染 TTS 服务商卡片
  renderTtsProviderCards(settings.ttsProvider);

  // AI 例句服务 Key（与翻译/TTS 共享 providers 数据）
  $('#ai-qwen-apiKey').value = settings.providers.qwen?.apiKey || '';
  $('#ai-doubao-accessToken').value = settings.providers.doubao?.accessToken || '';
  $('#ai-minimax-apiKey').value = settings.providers.minimax?.apiKey || '';

  // Qwen
  $('#qwen-apiKey').value = settings.providers.qwen?.apiKey || '';

  // 豆包
  $('#doubao-appId').value = settings.providers.doubao.appId || '';
  $('#doubao-accessToken').value = settings.providers.doubao.accessToken || '';
  $('#doubao-voiceType').value = settings.providers.doubao.voiceType || 'BV056_streaming';

  // DashScope
  $('#dashscope-apiKey').value = settings.providers.dashscope.apiKey || '';
  $('#dashscope-model').value = settings.providers.dashscope.model || 'qwen3-tts-flash';
  $('#dashscope-voice').value = settings.providers.dashscope.voice || 'Ethan';

  // MiniMax
  $('#minimax-groupId').value = settings.providers.minimax.groupId || '';
  $('#minimax-apiKey').value = settings.providers.minimax.apiKey || '';
  $('#minimax-voiceId').value = settings.providers.minimax.voiceId || 'English_expressive_narrator_v2';
}

function collectSettings() {
  const activeTranslationCard = $('#translationProviderCards .provider-card.active');
  const activeTtsCard = $('#ttsProviderCards .provider-card.active');
  const activeAiCard = $('#aiProviderCards .provider-card.active');

  // AI 区域填写的 Key 值（用户可能在 AI 区域填了 key，需要同步到 providers）
  const aiQwenKey = $('#ai-qwen-apiKey').value.trim();
  const aiDoubaoToken = $('#ai-doubao-accessToken').value.trim();
  const aiMinimaxKey = $('#ai-minimax-apiKey').value.trim();

  // 翻译/TTS 区域填写的值
  const ttsQwenKey = $('#qwen-apiKey').value.trim();
  const ttsDoubaoToken = $('#doubao-accessToken').value.trim();
  const ttsMinimaxKey = $('#minimax-apiKey').value.trim();

  return {
    pronunciation: $('input[name="pronunciation"]:checked')?.value || 'us',
    showTranslation: $('#showTranslation').checked,
    sourceLanguage: $('#sourceLanguage').value || 'en',
    targetLanguage: $('#targetLanguage').value || 'zh-CN',
    translationProvider: activeTranslationCard?.dataset.provider || 'google',
    aiProvider: activeAiCard?.dataset.provider || 'qwen',
    ttsProvider: activeTtsCard?.dataset.provider || 'free-dict',
    providers: {
      qwen: {
        apiKey: aiQwenKey || ttsQwenKey
      },
      doubao: {
        appId: $('#doubao-appId').value.trim(),
        accessToken: aiDoubaoToken || ttsDoubaoToken,
        cluster: 'volcano_tts',
        voiceType: $('#doubao-voiceType').value.trim() || 'BV056_streaming'
      },
      dashscope: {
        apiKey: $('#dashscope-apiKey').value.trim(),
        model: $('#dashscope-model').value || 'qwen3-tts-flash',
        voice: $('#dashscope-voice').value || 'Ethan'
      },
      minimax: {
        groupId: $('#minimax-groupId').value.trim(),
        apiKey: aiMinimaxKey || ttsMinimaxKey,
        model: 'speech-01-turbo',
        voiceId: $('#minimax-voiceId').value.trim() || 'English_expressive_narrator_v2'
      }
    }
  };
}

function showSaveStatus(text) {
  const el = $('#saveStatus');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// 事件绑定
$('#saveBtn').addEventListener('click', async () => {
  const settings = collectSettings();
  await saveSettings(settings);
  showSaveStatus('已保存');
});

// 密码显示/隐藏切换
$$('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(`#${btn.dataset.target}`);
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '隐藏';
    } else {
      input.type = 'password';
      btn.textContent = '显示';
    }
  });
});

// 快捷键设置链接
$('#openShortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ========== API 测试功能 ==========

// 根据 provider 和 type 收集当前表单中的配置
function getTestConfig(type, provider) {
  if (type === 'translation') {
    if (provider === 'google') return {};
    if (provider === 'qwen') return { apiKey: $('#qwen-apiKey').value.trim() || $('#ai-qwen-apiKey').value.trim() };
    if (provider === 'doubao') return { accessToken: $('#doubao-accessToken').value.trim() || $('#ai-doubao-accessToken').value.trim() };
    if (provider === 'minimax') return { apiKey: $('#minimax-apiKey').value.trim() || $('#ai-minimax-apiKey').value.trim() };
  }
  if (type === 'ai') {
    if (provider === 'qwen') return { apiKey: $('#ai-qwen-apiKey').value.trim() || $('#qwen-apiKey').value.trim() };
    if (provider === 'doubao') return { accessToken: $('#ai-doubao-accessToken').value.trim() || $('#doubao-accessToken').value.trim() };
    if (provider === 'minimax') return { apiKey: $('#ai-minimax-apiKey').value.trim() || $('#minimax-apiKey').value.trim() };
  }
  if (type === 'tts') {
    if (provider === 'free-dict') return {};
    if (provider === 'doubao') return {
      appId: $('#doubao-appId').value.trim(),
      accessToken: $('#doubao-accessToken').value.trim(),
      cluster: 'volcano_tts',
      voiceType: $('#doubao-voiceType').value.trim() || 'BV056_streaming'
    };
    if (provider === 'dashscope') return {
      apiKey: $('#dashscope-apiKey').value.trim(),
      model: $('#dashscope-model').value || 'qwen3-tts-flash',
      voice: $('#dashscope-voice').value || 'Ethan'
    };
    if (provider === 'minimax') return {
      groupId: $('#minimax-groupId').value.trim(),
      apiKey: $('#minimax-apiKey').value.trim(),
      model: 'speech-01-turbo',
      voiceId: $('#minimax-voiceId').value.trim() || 'English_expressive_narrator_v2'
    };
  }
  return {};
}

// 渲染日志到指定容器
function renderTestLog(logEl, response, elapsedMs) {
  logEl.classList.add('visible');
  let html = '';

  // 渲染每条日志行
  if (response.logs) {
    for (const entry of response.logs) {
      const timeTag = `<span class="log-time">[${entry.time}ms]</span>`;
      const levelClass = `log-${entry.level}`;
      html += `<div class="log-line ${levelClass}">${timeTag}${escapeForHtml(entry.msg)}</div>`;
      if (entry.data) {
        html += `<div class="log-data">${escapeForHtml(JSON.stringify(entry.data))}</div>`;
      }
    }
  }

  // 最终结果
  if (response.error) {
    html += `<div class="log-line log-error">FAIL — ${escapeForHtml(response.error)}</div>`;
  } else {
    html += `<div class="log-line log-success">OK — 模型: ${escapeForHtml(response.model || '?')} | 耗时: ${elapsedMs}ms</div>`;
    if (response.result) {
      html += `<div class="log-data">结果: ${escapeForHtml(response.result)}</div>`;
    }
  }

  logEl.innerHTML = html;
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeForHtml(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 绑定所有测试按钮
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.test-btn');
  if (!btn) return;

  const type = btn.dataset.testType;
  const provider = btn.dataset.testProvider;
  const logEl = $(`#log-${type}-${provider}`);

  if (!logEl) return;

  // 禁用按钮
  const origText = btn.textContent;
  btn.textContent = '测试中';
  btn.classList.add('loading');
  logEl.classList.add('visible');
  logEl.innerHTML = '<div class="log-line log-info">正在发送测试请求...</div>';

  const config = getTestConfig(type, provider);
  const start = Date.now();

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'testApi',
      type,
      provider,
      config
    });
    const elapsed = Date.now() - start;
    renderTestLog(logEl, response, elapsed);
  } catch (error) {
    const elapsed = Date.now() - start;
    renderTestLog(logEl, { error: error.message, logs: [] }, elapsed);
  }

  btn.textContent = origText;
  btn.classList.remove('loading');
});

// ========== 缓存管理 ==========

async function loadCacheStats() {
  try {
    const stats = await db.getAudioCacheStats();
    $('#cacheCount').textContent = stats.count;
    $('#cacheSize').textContent = stats.estimatedSizeKB;
  } catch (e) {
    console.error('Failed to load cache stats:', e);
  }
}

$('#clearCacheBtn').addEventListener('click', async () => {
  const btn = $('#clearCacheBtn');
  btn.disabled = true;
  btn.textContent = '清除中...';
  try {
    await db.clearAudioCache();
    await loadCacheStats();
    btn.textContent = '已清除';
    setTimeout(() => {
      btn.textContent = '清除全部音频缓存';
      btn.disabled = false;
    }, 1500);
  } catch (e) {
    console.error('Failed to clear cache:', e);
    btn.textContent = '清除失败';
    setTimeout(() => {
      btn.textContent = '清除全部音频缓存';
      btn.disabled = false;
    }, 1500);
  }
});

// ========== TTS 配置摘要 + 发音日志 ==========

async function loadTtsStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getTtsStatus' });
    if (!response?.success) return;

    $('#ttsStatusProvider').textContent = response.providerName || '—';
    $('#ttsStatusVoice').textContent = response.voice || '(默认)';
    $('#ttsStatusAccent').textContent = response.pronunciation === 'uk' ? '英式 (UK)' : '美式 (US)';

    const stateEl = $('#ttsStatusState');
    if (response.configured) {
      stateEl.textContent = '● 已配置';
      stateEl.className = 'tts-status-value configured';
    } else {
      stateEl.textContent = '● 未配置 API Key';
      stateEl.className = 'tts-status-value not-configured';
    }
  } catch (e) {
    console.error('Failed to load TTS status:', e);
  }
}

async function loadTtsLog() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getTtsLog' });
    if (!response?.success) return;

    const container = $('#ttsLogContainer');
    const log = response.log || [];

    if (log.length === 0) {
      container.innerHTML = '<p class="hint">暂无发音记录（使用扩展发音后这里会显示日志）</p>';
      return;
    }

    let html = `<table class="tts-log-table">
      <thead><tr><th>时间</th><th>文本</th><th>来源</th><th>耗时</th><th>状态</th></tr></thead><tbody>`;

    for (const entry of log) {
      const cls = entry.degraded ? 'degraded' : '';
      const badge = entry.degraded
        ? '<span class="log-badge warn">降级</span>'
        : '<span class="log-badge ok">正常</span>';
      html += `<tr class="${cls}">
        <td>${escapeForHtml(entry.time)}</td>
        <td>${escapeForHtml(entry.text)}</td>
        <td>${escapeForHtml(entry.source)}</td>
        <td>${entry.elapsedMs}ms</td>
        <td>${badge}</td>
      </tr>`;
    }

    html += '</tbody></table>';

    if (response.degradations >= 3) {
      html = `<div style="padding: 8px 12px; background: rgba(240, 192, 128, 0.15); border-radius: 8px; margin-bottom: 10px; font-size: 13px; color: var(--warning);">
        ⚠ 连续 ${response.degradations} 次发音降级，请检查 TTS 服务商配置
      </div>` + html;
    }

    container.innerHTML = html;
  } catch (e) {
    console.error('Failed to load TTS log:', e);
  }
}

$('#refreshLogBtn').addEventListener('click', () => {
  loadTtsLog();
  loadTtsStatus();
});

// ========== TTS 服务商切换自动测试 ==========

function autoTestTtsProvider(providerId) {
  // 延迟 300ms 等配置面板动画完成
  setTimeout(() => {
    const testBtn = document.querySelector(`#config-${providerId} .test-btn[data-test-type="tts"]`);
    if (testBtn) testBtn.click();
  }, 300);
}

// 初始化
loadSettings();
loadCacheStats();
loadTtsStatus();
loadTtsLog();
