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
    sizeObserver,
    current,
    lastTriggered = -Infinity,
    lastText = '';
  const style = `
    :host { color-scheme: light dark; }
    * { box-sizing: border-box; }
    .card { --bg:#fff; --text:#252630; --secondary:#60616d; --line:#dededc; --accent:#4d52bd; --tint:#ededfa; --warn:#8b621c; width:min(380px,calc(100vw - 24px)); max-height:min(640px,calc(100vh - 24px)); overflow:auto; overscroll-behavior:contain; padding:18px; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:18px; box-shadow:0 12px 44px #20203524,0 2px 6px #2020350d; font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; text-align:left; -webkit-font-smoothing:antialiased; animation:enter .16s ease-out; }
    .brand { display:flex; align-items:center; gap:7px; margin-bottom:12px; color:var(--secondary); font-size:10px; letter-spacing:.5px; }
    .brand svg { width:16px; height:16px; color:var(--accent); }
    .brand .close { margin-left:auto; }
    .head { display:flex; align-items:flex-start; gap:12px; }
    strong { flex:1; font:25px/1.3 'Iowan Old Style',Georgia,serif; letter-spacing:-.4px; overflow-wrap:anywhere; white-space:pre-wrap; max-height:132px; overflow:auto; }
    p { margin:8px 0 0; overflow-wrap:anywhere; }
    .phonetic { color:var(--secondary); font-size:12px; }
    .translation { margin-top:12px; font-size:15px; }
    .status { padding-top:12px; margin-top:14px; border-top:1px solid var(--line); color:var(--secondary); font-size:11px; line-height:1.75; }
    .error { color:var(--warn); font-size:12px; }
    .explanation-block { margin-top:16px; border-top:1px solid var(--line); padding-top:12px; }
    .explanation-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; color:var(--secondary); font-size:11px; }
    .model { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px; }
    .explanation { line-height:1.75; font-size:14px; white-space:pre-wrap; }
    .meaning-wait { margin-top:12px; color:var(--secondary); font-size:12px; }
    .progress { height:3px; overflow:hidden; margin-top:8px; border-radius:4px; background:var(--tint); }
    .progress::after { content:''; display:block; height:100%; width:38%; border-radius:inherit; background:var(--accent); animation:waiting 1.2s ease-in-out infinite; }
    .explanation-actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:12px; }
    .explanation-actions button { min-height:32px; padding:6px 9px; }
    .add-context { margin-left:auto; color:var(--secondary); border-color:transparent; }
    .context-form { margin-top:12px; }
    .context-form label { display:block; color:var(--secondary); font-size:11px; margin-bottom:6px; }
    textarea { display:block; width:100%; min-height:70px; max-height:160px; resize:vertical; font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif; padding:9px 10px; border:1px solid var(--line); border-radius:9px; background:var(--bg); color:var(--text); }
    textarea::placeholder { color:var(--secondary); }
    .context-footer { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:7px; font-size:10px; color:var(--secondary); }
    .submit-context { color:var(--accent); background:var(--tint); border-color:transparent; }
    .explanation-error { color:var(--warn); font-size:12px; }
    .explanation-recovery { display:flex; align-items:center; gap:8px; margin-top:8px; }
    button:disabled,textarea:disabled { opacity:.55; cursor:default; }
    button:disabled:active { transform:none; }
    .buttons { display:flex; align-items:center; gap:8px; margin-top:14px; }
    .buttons .escape { margin-left:auto; font-size:10px; color:var(--secondary); }
    .speech-controls { display:flex; align-items:center; gap:8px; margin-top:12px; }
    .speech-controls label { color:var(--secondary); font-size:12px; flex-shrink:0; }
    .speech-provider { min-width:0; flex:1; font:12px -apple-system,BlinkMacSystemFont,sans-serif; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:8px; min-height:32px; padding:5px; }
    .configure { flex-shrink:0; padding:6px 8px; }
    button { font:12px -apple-system,BlinkMacSystemFont,sans-serif; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:9px; min-height:32px; padding:7px 11px; cursor:pointer; }
    button:hover { background:var(--tint); } button:active { transform:scale(.97); }
    button:focus-visible,select:focus-visible,textarea:focus-visible { outline:3px solid var(--accent); outline-offset:2px; }
    .replay { color:var(--accent); background:var(--tint); border-color:transparent; }
    .close { border:0; min-height:26px; width:26px; padding:0; color:var(--secondary); font-size:19px; }
    [hidden] { display:none!important; }
    @keyframes enter { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
    @keyframes waiting { from { transform:translateX(-100%); } to { transform:translateX(365%); } }
    @media(prefers-color-scheme:dark) { .card { --bg:#23242c; --text:#ececf2; --secondary:#b9bac8; --line:#3b3c49; --accent:#b2b5ff; --tint:#32334e; --warn:#e3c189; box-shadow:0 12px 44px #0006; } }
    @media(prefers-reduced-motion:reduce) { .card,.progress::after { animation:none; } .progress::after { width:100%; opacity:.55; } button:active { transform:none; } }
    @media(prefers-contrast:more) { .card,button { border-color:var(--secondary); } }
  `;
  function scheduleDismiss() {
    clearTimeout(timer);
    if (current?.explanation || current?.meaningPending || current?.refining || current?.noteOpen)
      return;
    if (!host?.matches(':hover') && !shadow?.activeElement) timer = setTimeout(dismiss, 12000);
  }
  function dismiss() {
    clearTimeout(timer);
    sizeObserver?.disconnect();
    if (chrome.runtime?.id && current && !current.dismissed && current.requestId) {
      try {
        chrome.runtime
          .sendMessage({ action: 'dismissSelection', requestId: current.requestId })
          .catch(() => {});
      } catch {
        /* An extension update may invalidate this page's context during cleanup. */
      }
    }
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
    renderExplanation();
    if (current.lookupDone && (current.speaking || current.speechError || current.stopped)) {
      scheduleDismiss();
    }
    position();
  }
  function renderExplanation() {
    const busy = !!(current.meaningPending || current.refining);
    const hasAnswer = !!current.explanation;
    const block = shadow.querySelector('.explanation-block');
    block.setAttribute('aria-busy', String(busy));
    setLine('explanation', current.explanation || '');
    setLine('model', current.model || '');
    shadow.querySelector('.model').title = current.model
      ? `自动选择 · ${current.model} · ${(current.elapsedMs / 1000).toFixed(1)} 秒`
      : '';
    shadow.querySelector('.meaning-wait').hidden = !busy;
    setLine('waiting-label', current.refining ? '正在调整解释…' : '正在翻译并解释…');
    shadow.querySelector('.explanation-actions').hidden = !hasAnswer;
    for (const selector of ['.deeper', '.simpler', '.add-context', '.context-note'])
      shadow.querySelector(selector).disabled = busy;
    shadow.querySelector('.submit-context').disabled =
      busy || !shadow.querySelector('.context-note').value.trim();
    setLine('explanation-error', current.explanationError || '');
    shadow.querySelector('.explanation-recovery').hidden = busy || !current.explanationError;
  }
  async function refine(direction = 'initial') {
    const entry = current;
    if (!entry || entry.dismissed || entry.meaningPending || entry.refining) return;
    const note = shadow.querySelector('.context-note').value.trim();
    const editorWasOpen = entry.noteOpen;
    setNoteOpen(false);
    shadow.querySelector('.context-note').value = '';
    if (editorWasOpen) shadow.querySelector('.explanation').focus({ preventScroll: true });
    entry.lastDirection = direction;
    entry.refining = true;
    entry.explanationError = '';
    clearTimeout(timer);
    render();
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'explainSelection',
        requestId: entry.requestId,
        word: entry.text,
        sentence: entry.sentence,
        direction,
        note,
        history: entry.history,
      });
      if (current !== entry || entry.dismissed) return;
      if (!result?.success) throw new Error(result?.error || '解释失败，请重试');
      entry.explanation = result.explanation;
      entry.model = result.model;
      entry.elapsedMs = result.elapsedMs;
      if (result.translation) {
        entry.translation = result.translation;
        entry.lookupWarning = '';
      }
      entry.history = [
        ...entry.history,
        { direction, note, explanation: result.explanation },
      ].slice(-6);
    } catch (error) {
      if (current !== entry || entry.dismissed) return;
      entry.explanationError = error.message || '连接已中断，请刷新网页后重试';
      if (note) {
        shadow.querySelector('.context-note').value = note;
        setNoteOpen(true);
      }
    } finally {
      entry.refining = false;
      if (current === entry && !entry.dismissed) render();
    }
  }
  function setNoteOpen(open) {
    current.noteOpen = open;
    shadow.querySelector('.context-form').hidden = !open;
    shadow.querySelector('.add-context').setAttribute('aria-expanded', String(open));
  }
  function renderSpeechOptions(options) {
    const select = shadow?.querySelector('.speech-provider');
    if (!select || !options) return;
    select.replaceChildren(
      ...options.providers.map((provider) => {
        const label = `${provider.name}${provider.model ? ` · ${provider.model}` : ''}${provider.configured ? '' : '（未配置）'}`;
        const option = new Option(label, provider.id);
        option.disabled = !provider.configured;
        return option;
      }),
    );
    select.value = options.provider;
    select.disabled = false;
  }
  async function refreshSpeechOptions() {
    const entry = current;
    if (!host || !entry || entry.dismissed) return;
    try {
      const result = await chrome.runtime.sendMessage({ action: 'getSpeechOptions' });
      if (current === entry && !entry.dismissed && result?.success) {
        renderSpeechOptions(result.speechOptions);
      }
    } catch {
      /* A stale extension context is explained on the next playback attempt. */
    }
  }
  async function replay(provider) {
    const entry = current;
    if (!entry?.text || entry.dismissed) return;
    const playbackId = crypto.randomUUID();
    entry.playbackId = playbackId;
    entry.stopped = false;
    entry.speaking = false;
    entry.speech = '';
    entry.speechError = '';
    entry.speechWarning = '';
    clearTimeout(timer);
    render();
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'replaySelection',
        requestId: entry.requestId,
        word: entry.text,
        ...(provider ? { provider } : {}),
      });
      if (current !== entry || entry.dismissed || entry.playbackId !== playbackId) return;
      if (!result?.success) throw new Error(result?.error || '朗读失败，请重试');
      entry.speech = result.speech.ttsSource.label;
      entry.speechWarning = result.speech.fallbackReason || '';
      entry.speaking = true;
      renderSpeechOptions(result.speechOptions);
    } catch (error) {
      if (current !== entry || entry.dismissed || entry.playbackId !== playbackId) return;
      entry.speechError = error.message || '连接已中断，请刷新网页后重试';
      refreshSpeechOptions();
    }
    render();
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
    shadow.innerHTML = `<style>${style}</style><div class="card" role="region" aria-label="WordVoice 选词结果">
      <div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/></svg>WordVoice<button class="close" aria-label="关闭">×</button></div>
      <div class="head"><strong tabindex="0"></strong></div>
      <div role="status" aria-live="polite"><p class="phonetic" hidden></p><p class="translation" hidden></p></div>
      <section class="explanation-block" aria-label="AI 解释">
        <div class="explanation-heading"><span>AI 解释</span><span class="model" hidden></span></div>
        <p class="explanation" role="status" aria-live="polite" tabindex="-1" hidden></p>
        <div class="meaning-wait"><span class="waiting-label">正在翻译并解释…</span><div class="progress" role="progressbar" aria-label="正在生成翻译与解释"></div></div>
        <div class="explanation-actions" hidden>
          <button class="deeper" title="补充原理和细节">＋ 太浅了</button><button class="simpler" title="用常用词和例子解释">－ 太深了</button>
          <button class="add-context" aria-expanded="false" aria-controls="context-form">补充说明</button>
        </div>
        <form class="context-form" id="context-form" hidden>
          <label for="context-note">附加说明（可选）</label>
          <textarea class="context-note" id="context-note" maxlength="500" rows="2" placeholder="例如：用一个生活中的例子解释"></textarea>
          <div class="context-footer"><span>Ctrl / ⌘ + Enter 发送</span><button class="submit-context" type="submit" disabled>重新解释</button></div>
        </form>
        <p class="explanation-error" role="status" hidden></p>
        <div class="explanation-recovery" hidden><button class="retry-explanation">重试</button><button class="configure-ai">配置 AI</button></div>
      </section>
      <div role="status" aria-live="polite"><p class="status">正在启动朗读…</p><p class="error" hidden></p></div>
      <div class="speech-controls"><label for="speech-provider">发音</label><select id="speech-provider" class="speech-provider" aria-label="发音服务，切换后重读并记住选择" disabled><option>正在加载…</option></select><button class="configure" title="配置语音服务 Key 和音色">配置</button></div>
      <div class="buttons"><button class="replay">再读一次</button><button class="stop">停止朗读</button><span class="escape">Esc 关闭</span></div>
    </div>`;
    shadow.querySelector('strong').textContent = text;
    shadow.querySelector('.close').onclick = dismiss;
    shadow.querySelector('.stop').onclick = () => {
      chrome.runtime.sendMessage({ action: 'stopSpeech' }).catch(() => {});
      if (current) {
        current.playbackId = crypto.randomUUID();
        current.stopped = true;
        render();
      }
    };
    shadow.querySelector('.replay').onclick = () => replay();
    shadow.querySelector('.speech-provider').onchange = (event) => replay(event.target.value);
    shadow.querySelector('.deeper').onclick = () => refine('deeper');
    shadow.querySelector('.simpler').onclick = () => refine('simpler');
    shadow.querySelector('.retry-explanation').onclick = () =>
      refine(current.lastDirection || 'initial');
    shadow.querySelector('.add-context').onclick = () => {
      setNoteOpen(!current.noteOpen);
      if (current.noteOpen) shadow.querySelector('.context-note').focus();
      position();
    };
    shadow.querySelector('.context-note').oninput = renderExplanation;
    shadow.querySelector('.context-form').onsubmit = (event) => {
      event.preventDefault();
      if (shadow.querySelector('.context-note').value.trim()) refine('context');
    };
    shadow.querySelector('.context-note').onkeydown = (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        shadow.querySelector('.context-form').requestSubmit();
      }
    };
    shadow.querySelector('.configure').onclick = async () => {
      try {
        const result = await chrome.runtime.sendMessage({ action: 'openSpeechSettings' });
        if (!result?.success) throw new Error('无法打开设置，请从扩展菜单打开');
      } catch (error) {
        setLine('error', error.message);
      }
    };
    shadow.querySelector('.configure-ai').onclick = shadow.querySelector('.configure').onclick;
    host.addEventListener('mouseenter', () => clearTimeout(timer));
    host.addEventListener('focusin', () => clearTimeout(timer));
    host.addEventListener('focusout', () => setTimeout(scheduleDismiss, 0));
    host.addEventListener('mouseleave', () => {
      scheduleDismiss();
    });
    (document.body || document.documentElement).appendChild(host);
    sizeObserver = new ResizeObserver(position);
    sizeObserver.observe(shadow.querySelector('.card'));
  }
  function fail(text) {
    show('WordVoice', null);
    current = { dismissed: false, rect: null };
    shadow.querySelector('.speech-controls').hidden = true;
    shadow.querySelector('.buttons').hidden = true;
    shadow.querySelector('.explanation-block').hidden = true;
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
    current = {
      requestId,
      playbackId: requestId,
      text,
      rect,
      sentence,
      dismissed: false,
      meaningPending: true,
      history: [],
    };
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
        current.meaningPending = false;
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
  window.addEventListener('focus', refreshSpeechOptions, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) refreshSpeechOptions();
    },
    { signal },
  );
  window.addEventListener('pagehide', dismiss, { signal });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!state.alive || sender.id !== chrome.runtime.id) return false;
    if (message.action === 'speechOptionsChanged') {
      renderSpeechOptions(message.speechOptions);
      respond({ success: true });
      return false;
    }
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
      if (message.speechRequestId && message.speechRequestId !== current.playbackId) return false;
      if (message.speechOptions) renderSpeechOptions(message.speechOptions);
      if (message.explanation && !current.history.length) {
        current.history.push({ direction: 'initial', note: '', explanation: message.explanation });
      }
      Object.assign(current, message);
      render();
      respond({ success: true });
    }
    return false;
  });
})();
