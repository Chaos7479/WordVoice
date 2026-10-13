(() => {
  // This entry point is also injected after install/update and command recovery.
  if (globalThis.__wordvoiceV2?.alive) return;
  globalThis.__wordvoiceV2?.destroy?.();
  const lifecycle = new AbortController();
  const { signal } = lifecycle;
  const state = {
    alive: true,
    destroy() {
      lifecycle.abort();
      dismiss();
      state.alive = false;
    },
  };
  globalThis.__wordvoiceV2 = state;
  let host,
    shadow,
    timer,
    current,
    lastTriggered = -Infinity,
    lastText = '';
  const style = `
    * { box-sizing: border-box; } .card { width: min(360px, calc(100vw - 24px)); max-height: min(480px, calc(100vh - 24px)); overflow: auto; padding: 16px; color: #eff4ff; background: #182336; border: 1px solid #506787; border-radius: 14px; box-shadow: 0 8px 32px #0005; font: 14px/1.5 system-ui, sans-serif; text-align: left; }
    .head { display: flex; align-items: flex-start; gap: 12px; } strong { flex: 1; font-size: 17px; overflow-wrap: anywhere; white-space: pre-wrap; } p { margin: 7px 0 0; overflow-wrap: anywhere; } .phonetic { color: #a8c4ef; } .status { color: #b8c8df; font-size: 12px; } .error { color: #ffd296; } .buttons { display: flex; gap: 8px; margin-top: 12px; } button { font: inherit; font-size: 12px; color: #eff4ff; background: #2c4261; border: 1px solid #617999; border-radius: 7px; padding: 5px 10px; cursor: pointer; } button:focus-visible { outline: 2px solid #8ac5ff; outline-offset: 2px; } .close { padding: 1px 7px; } [hidden] { display: none !important; }
  `;
  function dismiss() {
    clearTimeout(timer);
    host?.remove();
    host = null;
    shadow = null;
    if (current) current.dismissed = true;
  }
  function setLine(className, text) {
    const node = shadow?.querySelector(`.${className}`);
    if (node) {
      node.textContent = text;
      node.hidden = !text;
    }
  }
  function render() {
    if (!shadow || !current || current.dismissed) return;
    setLine('phonetic', current.phonetic || '');
    setLine('translation', current.translation || current.definition || '');
    setLine(
      'status',
      [
        current.saved
          ? `已保存 · 第 ${current.frequency} 次查询`
          : current.saveError
            ? '保存失败'
            : '正在保存…',
        current.stopped ? '已停止' : current.speech || '正在启动朗读…',
      ].join(' · '),
    );
    setLine(
      'error',
      [current.speechError, current.saveError, current.speechWarning, current.lookupWarning]
        .filter(Boolean)
        .join('；'),
    );
    if (current.lookupDone && (current.speaking || current.speechError || current.stopped)) {
      clearTimeout(timer);
      timer = setTimeout(dismiss, 12000);
    }
    position();
  }
  function position() {
    if (!host) return;
    const rect = current?.rect;
    const box = host.getBoundingClientRect();
    let left = rect ? rect.left + rect.width / 2 - box.width / 2 : innerWidth - box.width - 16;
    let top = rect ? rect.bottom + 10 : innerHeight - box.height - 16;
    if (rect && top + box.height > innerHeight - 12) top = rect.top - box.height - 10;
    host.style.setProperty(
      'left',
      `${Math.max(12, Math.min(left, innerWidth - box.width - 12))}px`,
      'important',
    );
    host.style.setProperty(
      'top',
      `${Math.max(12, Math.min(top, innerHeight - box.height - 12))}px`,
      'important',
    );
  }
  function show(text, rect) {
    dismiss();
    host = document.createElement('wordvoice-popup');
    // Keep the reset and the coordinates in the same style scope. An !important
    // :host reset would override outer inline left/top and leave the popup at its static position.
    host.style.cssText =
      'all: initial !important; position: fixed !important; z-index: 2147483647 !important; display: block !important;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${style}</style><div class="card" role="region" aria-label="WordVoice 选词结果"><div class="head"><strong></strong><button class="close" aria-label="关闭">×</button></div><div role="status" aria-live="polite"><p class="phonetic" hidden></p><p class="translation" hidden></p><p class="status">正在启动朗读…</p><p class="error" hidden></p></div><div class="buttons"><button class="replay">再读一次</button><button class="stop">停止朗读</button></div></div>`;
    shadow.querySelector('strong').textContent = text;
    shadow.querySelector('.close').onclick = dismiss;
    shadow.querySelector('.stop').onclick = () => {
      chrome.runtime.sendMessage({ action: 'stopSpeech' }).catch(() => {});
      if (current) {
        current.stopped = true;
        render();
      }
    };
    shadow.querySelector('.replay').onclick = () => {
      if (current) start(current.text, current.rect, current.sentence);
    };
    host.addEventListener('mouseenter', () => clearTimeout(timer));
    host.addEventListener('mouseleave', () => {
      clearTimeout(timer);
      timer = setTimeout(dismiss, 12000);
    });
    (document.body || document.documentElement).appendChild(host);
  }
  function fail(text) {
    show('WordVoice', null);
    current = { dismissed: false, rect: null };
    setLine('status', '');
    setLine('error', text);
    position();
    timer = setTimeout(dismiss, 8000);
  }
  async function start(raw, rect, sentence = '') {
    if (!chrome.runtime?.id) {
      fail('扩展已更新，请刷新当前网页后重试');
      return;
    }
    const text = raw.replace(/\s+/gu, ' ').trim();
    if (!text) {
      fail('请先用鼠标选中文本，再按 S');
      return;
    }
    if (text.length > 2000) {
      fail('每次最多朗读 2000 个字符，请缩短选区');
      return;
    }
    const requestId = crypto.randomUUID();
    show(text, rect);
    current = { requestId, text, rect, sentence, dismissed: false };
    render();
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'pronounce',
        requestId,
        word: text,
        sentence,
        pageUrl: location.href,
        pageTitle: document.title,
      });
      if (current?.requestId !== requestId || current.dismissed) return;
      if (!response?.success) {
        current.speechError = response?.error || '请求失败，请重试';
        current.lookupDone = true;
        render();
      }
    } catch {
      if (current?.requestId === requestId) fail('连接已中断，请刷新当前网页后重试');
    }
  }
  function focusedElement() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  function editable(event) {
    const elements = event ? event.composedPath() : [focusedElement()];
    return elements.some(
      (el) =>
        el instanceof Element &&
        (el.matches('input, textarea, select, [role="textbox"], [role="combobox"]') ||
          el.isContentEditable),
    );
  }
  function selectionData(allowInput) {
    const focused = focusedElement();
    if (allowInput && focused?.matches('input, textarea')) {
      if (focused.type === 'password') return null;
      const start = focused.selectionStart;
      const end = focused.selectionEnd;
      if (typeof start === 'number' && end > start)
        return {
          text: focused.value.slice(start, end),
          rect: focused.getBoundingClientRect(),
          sentence: '',
        };
      return null;
    }
    const selection = getSelection();
    const text = selection?.toString().trim();
    if (!text || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    let parent = range.commonAncestorContainer;
    if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentElement;
    let context = text;
    if (
      parent &&
      !['BODY', 'HTML'].includes(parent.tagName) &&
      parent.textContent.length <= 12000
    ) {
      const full = parent.textContent.replace(/\s+/gu, ' ');
      const pos = full.indexOf(text);
      if (pos >= 0) context = full.slice(Math.max(0, pos - 180), pos + text.length + 180);
    }
    return { text, rect: range.getBoundingClientRect(), sentence: context.slice(0, 2000) };
  }
  function trigger(allowInput = false) {
    const selection = selectionData(allowInput);
    if (!selection) {
      if (allowInput) fail('请先选中文本');
      return;
    }
    const now = performance.now();
    if (selection.text === lastText && now - lastTriggered < 180) return;
    lastTriggered = now;
    lastText = selection.text;
    start(selection.text, selection.rect, selection.sentence);
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (!chrome.runtime?.id) {
        state.destroy();
        return;
      }
      if (event.key === 'Escape' && host) {
        dismiss();
        chrome.runtime.sendMessage({ action: 'stopSpeech' }).catch(() => {});
        return;
      }
      if (
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        editable(event)
      )
        return;
      if (!['s', '`'].includes(event.key.toLowerCase()) || !getSelection()?.toString().trim())
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      trigger();
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'scroll',
    (event) => {
      if (!event.composedPath().includes(host)) dismiss();
    },
    { capture: true, passive: true, signal },
  );
  window.addEventListener('resize', position, { passive: true, signal });
  window.addEventListener('pagehide', dismiss, { signal });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!state.alive || sender.id !== chrome.runtime.id) return false;
    if (message.action === 'getSelection') {
      // Only the focused frame handles a browser command; no local duplicate Ctrl+Shift+S listener.
      if (document.hasFocus() && !document.activeElement?.matches('iframe, frame')) trigger(true);
      respond({ success: true });
      return false;
    }
    if (
      message.action === 'lookupUpdate' &&
      current?.requestId === message.requestId &&
      !current.dismissed
    ) {
      Object.assign(current, message);
      render();
      respond({ success: true });
    }
    return false;
  });
})();
