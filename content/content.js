// WordVoice Content Script

// 记录最后一次选区的视口位置，用于 Toast 定位
let lastSelectionRect = null;

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getSelection') {
    handleGetSelection();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'showToast') {
    showToast(message.word, message.isNew, message.frequency, false, message.isSentence, message.translation, message.phonetic, message.ttsSource, message.degradationWarning);
    sendResponse({ success: true });
    return false;
  }

  // 音频播放（将 data URL 转为 Blob URL 绕过页面 CSP 限制）
  if (message.action === 'playAudioFallback') {
    (async () => {
      try {
        let audioUrl = message.url;
        // data URL 转 Blob URL 绕过 CSP
        if (audioUrl.startsWith('data:')) {
          const resp = await fetch(audioUrl);
          const blob = await resp.blob();
          audioUrl = URL.createObjectURL(blob);
        }
        const audio = new Audio(audioUrl);
        await audio.play();
        audio.onended = () => {
          if (audioUrl !== message.url) URL.revokeObjectURL(audioUrl);
          sendResponse({ success: true });
        };
        audio.onerror = () => sendResponse({ success: false });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

// 获取选中文本并发送发音请求
function handleGetSelection() {
  // 扩展重载后 content script 断连，提示刷新
  if (!chrome.runtime?.id) {
    showToast('扩展已更新，请刷新页面', false, 0, true);
    return;
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString().trim();

  if (!selectedText) {
    lastSelectionRect = null;
    showToast('请先选中文本', false, 0, true);
    return;
  }

  // 捕获选区位置用于 Toast 定位
  if (selection.rangeCount > 0) {
    lastSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
  }

  // 获取选中文本所在的句子上下文
  const sentence = getSelectionContext(selection);

  // 发送发音请求到 background
  chrome.runtime.sendMessage({
    action: 'pronounce',
    word: selectedText,
    sentence: sentence,
    pageUrl: window.location.href,
    pageTitle: document.title
  }).catch(error => {
    console.error('Failed to send pronounce message:', error);
  });

  // 添加高亮效果
  highlightSelection(selection);
}

// 获取选中文本的上下文句子
function getSelectionContext(selection) {
  if (!selection || selection.rangeCount === 0) return '';

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // 获取父元素的文本内容
  let parentText = '';
  if (container.nodeType === Node.TEXT_NODE) {
    parentText = container.parentElement?.textContent || '';
  } else {
    parentText = container.textContent || '';
  }

  // 尝试提取包含选中文本的句子
  const selectedText = selection.toString().trim();
  const sentences = parentText.split(/[.!?。！？]/);

  for (const sentence of sentences) {
    if (sentence.includes(selectedText)) {
      return sentence.trim();
    }
  }

  // 如果找不到完整句子，返回前后 100 个字符
  const fullText = parentText;
  const index = fullText.indexOf(selectedText);
  if (index !== -1) {
    const start = Math.max(0, index - 50);
    const end = Math.min(fullText.length, index + selectedText.length + 50);
    return fullText.substring(start, end).trim();
  }

  return selectedText;
}

// 高亮选中文本
function highlightSelection(selection) {
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  // 创建高亮 span
  const highlight = document.createElement('span');
  highlight.className = 'wordvoice-highlight';

  try {
    range.surroundContents(highlight);

    // 1秒后移除高亮
    setTimeout(() => {
      const parent = highlight.parentNode;
      if (parent) {
        while (highlight.firstChild) {
          parent.insertBefore(highlight.firstChild, highlight);
        }
        parent.removeChild(highlight);
      }
    }, 1000);
  } catch (e) {
    // 如果 surroundContents 失败（跨元素选择），忽略高亮
    console.log('Could not highlight selection');
  }
}

// 显示 Toast 提示
function showToast(word, isNew, frequency, isError = false, isSentence = false, translation = '', phonetic = '', ttsSource = '', degradationWarning = false) {
  // 移除已有的 toast 和滚动监听
  dismissToast();

  const toast = document.createElement('div');
  toast.className = 'wordvoice-toast';

  // TTS 来源信息（底部小字）
  const sourceHtml = ttsSource
    ? `<div class="wordvoice-toast-source">${degradationWarning ? '⚠ ' : '🔊 '}${escapeHtml(ttsSource)}</div>`
    : '';

  if (isError) {
    toast.innerHTML = `<span class="wordvoice-toast-icon">&#9888;</span> ${word}`;
    toast.classList.add('wordvoice-toast-error');
  } else if (isSentence) {
    const statusText = isNew ? '已收录' : (frequency > 0 ? `第 ${frequency} 次` : '朗读中');
    const translationHtml = translation
      ? `<div class="wordvoice-toast-translation">${escapeHtml(translation)}</div>`
      : '';
    toast.innerHTML = `
      <span class="wordvoice-toast-icon">&#9834;</span>
      <div class="wordvoice-toast-body">
        <div class="wordvoice-toast-row">
          <span class="wordvoice-toast-word">${escapeHtml(word)}</span>
          <span class="wordvoice-toast-status">${statusText}</span>
        </div>
        ${translationHtml}
        ${sourceHtml}
      </div>
    `;
  } else {
    const statusText = isNew ? '已添加' : `第 ${frequency} 次`;
    const phoneticHtml = phonetic
      ? `<div class="wordvoice-toast-phonetic">${escapeHtml(phonetic)}</div>`
      : '';
    const translationHtml = translation
      ? `<div class="wordvoice-toast-translation">${escapeHtml(translation)}</div>`
      : '';
    toast.innerHTML = `
      <span class="wordvoice-toast-icon">&#9834;</span>
      <div class="wordvoice-toast-body">
        <div class="wordvoice-toast-row">
          <span class="wordvoice-toast-word">${escapeHtml(word)}</span>
          <span class="wordvoice-toast-status">${statusText}</span>
        </div>
        ${phoneticHtml}
        ${translationHtml}
        ${sourceHtml}
      </div>
    `;
  }

  document.body.appendChild(toast);

  // 定位 Toast：跟随选区或回退到右下角
  const hasSelectionPos = lastSelectionRect && lastSelectionRect.width > 0;
  const isAbove = positionToast(toast, lastSelectionRect);
  if (hasSelectionPos) {
    toast.classList.add(isAbove ? 'wordvoice-toast--above' : 'wordvoice-toast--below');
  }

  // 滚动时自动关闭
  const onScroll = () => dismissToast();
  window.addEventListener('scroll', onScroll, { once: true, passive: true });

  // 有翻译时显示久一点
  const duration = translation ? 3000 : 2500;
  setTimeout(() => {
    window.removeEventListener('scroll', onScroll);
    const existing = document.querySelector('.wordvoice-toast');
    if (existing) {
      existing.classList.add('wordvoice-toast-fadeout');
      setTimeout(() => existing.remove(), 300);
    }
  }, duration);
}

// 关闭当前 Toast
function dismissToast() {
  const existing = document.querySelector('.wordvoice-toast');
  if (existing) existing.remove();
}

// 计算 Toast 位置：跟随选区定位
function positionToast(toast, selectionRect) {
  const GAP = 10;
  const EDGE_PADDING = 12;

  // 无选区信息时回退到右下角
  if (!selectionRect || selectionRect.width === 0) {
    toast.style.bottom = '28px';
    toast.style.right = '28px';
    toast.style.top = 'auto';
    toast.style.left = 'auto';
    return false;
  }

  // 先让浏览器计算 toast 尺寸
  const toastRect = toast.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 垂直方向：优先下方，空间不足则上方
  const spaceBelow = vh - selectionRect.bottom - GAP;
  const spaceAbove = selectionRect.top - GAP;
  let top;
  let isAbove = false;

  if (spaceBelow >= toastRect.height + EDGE_PADDING) {
    top = selectionRect.bottom + GAP;
  } else if (spaceAbove >= toastRect.height + EDGE_PADDING) {
    top = selectionRect.top - GAP - toastRect.height;
    isAbove = true;
  } else {
    // 两边都不够，选空间更大的一边
    if (spaceAbove > spaceBelow) {
      top = selectionRect.top - GAP - toastRect.height;
      isAbove = true;
    } else {
      top = selectionRect.bottom + GAP;
    }
  }

  // 水平方向：居中对齐选区
  let left = selectionRect.left + (selectionRect.width - toastRect.width) / 2;

  // 边界钳制
  left = Math.max(EDGE_PADDING, Math.min(left, vw - toastRect.width - EDGE_PADDING));
  top = Math.max(EDGE_PADDING, Math.min(top, vh - toastRect.height - EDGE_PADDING));

  toast.style.top = `${top}px`;
  toast.style.left = `${left}px`;
  toast.style.bottom = 'auto';
  toast.style.right = 'auto';

  return isAbove;
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 检查是否在输入框中
function isInputFocused() {
  const activeElement = document.activeElement;
  const tagName = activeElement?.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || activeElement?.isContentEditable;
}

// 支持多种快捷键方式
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const hasSelection = window.getSelection()?.toString().trim().length > 0;

  // 方式1: 单按 S 键（有选中文本 + 不在输入框中）
  if (key === 's' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    if (hasSelection && !isInputFocused()) {
      e.preventDefault();
      handleGetSelection();
      return;
    }
  }

  // 方式2: Ctrl+Shift+S（任何情况下都可用）
  if (e.ctrlKey && e.shiftKey && key === 's') {
    e.preventDefault();
    handleGetSelection();
    return;
  }

  // 方式3: 反引号 ` 键（有选中文本 + 不在输入框中）
  if ((key === '`' || e.code === 'Backquote') && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (hasSelection && !isInputFocused()) {
      e.preventDefault();
      handleGetSelection();
      return;
    }
  }
});
