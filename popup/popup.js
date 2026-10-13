import {
  send,
  escapeHtml as esc,
  showStatus,
  play,
  displayWord,
  enableKeyboardClick,
  icon,
  emptyState,
  wireSearch,
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
    document.getElementById('listHeading').textContent = query ? '搜索结果' : '最近遇见';
    list.innerHTML = result.words.length
      ? result.words
          .map(
            (word) =>
              `<div class="word-item" data-id="${word.id}" ><button class="word-info word-open" aria-label="查看 ${esc(displayWord(word))}"><span class="word-text">${esc(displayWord(word))}</span><span class="word-phonetic">${esc(word.phonetic)}</span>${word.translation ? `<span class="word-translation">${esc(word.translation)}</span>` : ''}</button><div class="word-meta"><span class="word-frequency">${word.frequency}次</span><button class="btn-play" title="播放发音" aria-label="朗读 ${esc(displayWord(word))}">${icon('wave')}</button></div></div>`,
          )
          .join('')
      : emptyState(
          query ? '没有匹配结果' : '从一个好奇的词开始',
          query
            ? '试试原文、译文，或更短的关键词。'
            : '在网页选中文字，按 S。下次打开，它就在这里。',
          query ? 'search' : 'book',
        );
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
  wireSearch(document.getElementById('searchInput'), document.getElementById('clearSearch'), () => {
    clearTimeout(timer);
    timer = setTimeout(load, 150);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'dataChanged') {
      clearTimeout(timer);
      timer = setTimeout(load, 100);
    }
  });
  load();
});
