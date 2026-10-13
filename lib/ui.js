import { icon, hydrateIcons } from './icons.js';
export { icon };
globalThis.document?.addEventListener('DOMContentLoaded', () => hydrateIcons());
export function emptyState(title, description, symbol = 'book') {
  return `<div class="word-list-empty"><span class="empty-symbol">${icon(symbol)}</span><strong class="empty-title">${escapeHtml(title)}</strong><span class="empty-description">${escapeHtml(description)}</span></div>`;
}
export function wireSearch(input, clear, onSearch) {
  const changed = () => {
    clear.hidden = !input.value;
    onSearch();
  };
  input.addEventListener('input', changed);
  clear.onclick = () => {
    input.value = '';
    changed();
    input.focus();
  };
  document.addEventListener('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'f' &&
      !input.closest('[inert]') &&
      input.getClientRects().length
    ) {
      event.preventDefault();
      input.focus();
      input.select();
    }
    if (event.key === 'Escape' && document.activeElement === input && input.value) {
      event.preventDefault();
      input.value = '';
      changed();
    }
  });
}
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
export async function send(action, data = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...data });
  if (!response?.success) throw new Error(response?.error || '连接失败，请重新打开扩展');
  return response;
}
let statusTimer;
export function showStatus(text, error = false) {
  let el = document.getElementById('pageStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pageStatus';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  clearTimeout(statusTimer);
  const message = document.createElement('span');
  message.textContent = text;
  const close = document.createElement('button');
  close.setAttribute('aria-label', '关闭提示');
  close.innerHTML = icon('close');
  close.onclick = () => {
    el.hidden = true;
    clearTimeout(statusTimer);
  };
  el.replaceChildren(message, close);
  el.classList.toggle('error', error);
  el.hidden = false;
  statusTimer = setTimeout(
    () => {
      el.hidden = true;
    },
    error ? 9000 : 3500,
  );
}
export async function play(word, button) {
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    const result = await send('playOnly', { word });
    if (result.speech?.fallbackReason) showStatus(result.speech.fallbackReason);
  } catch (error) {
    if (error.name !== 'AbortError' && !/已停止|已切换/.test(error.message))
      showStatus(error.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}
export function displayWord(word) {
  return word.displayText || word.word;
}
export function enableKeyboardClick(container = document) {
  container.querySelectorAll('[role="button"]').forEach((el) => {
    el.tabIndex = 0;
    el.onkeydown = (event) => {
      if (event.target !== el) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        el.click();
      }
    };
  });
}
export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}
