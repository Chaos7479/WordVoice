import {
  send,
  escapeHtml as esc,
  showStatus,
  play,
  displayWord,
  enableKeyboardClick,
} from '../lib/ui.js';
let generation = 0;
let currentWindowId;
async function load() {
  const id = ++generation;
  const query = document.getElementById('searchInput').value.trim();
  try {
    const [result, summary] = await Promise.all([
      send('getWords', { options: { query, limit: 30 } }),
      send('getStats'),
    ]);
    if (id !== generation) return;
    for (const [key, element] of [
      ['today', 'todayCount'],
      ['week', 'weekCount'],
      ['total', 'totalCount'],
    ])
      document.getElementById(element).textContent = summary.stats[key];
    const list = document.getElementById('wordList');
    list.innerHTML = result.words.length
      ? result.words
          .map(
            (word) =>
              `<div class="word-item" data-id="${word.id}" role="button" aria-label="查看 ${esc(displayWord(word))}"><div class="word-info"><span class="word-text">${esc(displayWord(word))}</span><span class="word-phonetic">${esc(word.phonetic)}</span>${word.translation ? `<span class="word-translation">${esc(word.translation)}</span>` : ''}</div><div class="word-meta"><span class="word-frequency">${word.frequency}次</span><button class="btn-play" title="播放发音" aria-label="朗读 ${esc(displayWord(word))}">▶</button></div></div>`,
          )
          .join('')
      : `<div class="word-list-empty">${query ? '没有匹配结果' : '在网页选中文本，按 S 开始学习'}</div>`;
    list.querySelectorAll('.word-item').forEach((item) => {
      const word = result.words.find((w) => w.id === Number(item.dataset.id));
      item.onclick = () => openPanel(word.id);
      item.querySelector('.btn-play').onclick = (event) => {
        event.stopPropagation();
        play(displayWord(word), event.currentTarget);
      };
    });
    enableKeyboardClick(list);
  } catch (error) {
    showStatus(error.message, true);
  }
}
function openPanel(wordId) {
  if (!currentWindowId) {
    showStatus('窗口仍在加载，请重试', true);
    return;
  }
  // Invoke open synchronously within the click gesture, before awaiting storage.
  const pending = wordId
    ? chrome.storage.local.set({ pendingWordDetail: wordId })
    : Promise.resolve();
  const opened = chrome.sidePanel.open({ windowId: currentWindowId });
  Promise.all([pending, opened])
    .then(() => window.close())
    .catch((error) => showStatus(error.message, true));
}
document.addEventListener('DOMContentLoaded', () => {
  chrome.windows
    .getCurrent()
    .then((window) => {
      currentWindowId = window.id;
    })
    .catch((error) => showStatus(error.message, true));
  document.getElementById('openSidePanel').onclick = () => openPanel();
  document.getElementById('openSettings').onclick = () => chrome.runtime.openOptionsPage();
  document.getElementById('stopSpeech').onclick = () =>
    send('stopSpeech').catch((error) => showStatus(error.message, true));
  let timer;
  document.getElementById('searchInput').oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(load, 150);
  };
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'dataChanged') {
      clearTimeout(timer);
      timer = setTimeout(load, 100);
    }
  });
  load();
});
