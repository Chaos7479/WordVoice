// WordVoice Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await loadRecentWords();
  setupEventListeners();
});

// 加载统计数据
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStats' });
    if (response.success) {
      document.getElementById('todayCount').textContent = response.stats.today;
      document.getElementById('weekCount').textContent = response.stats.week;
      document.getElementById('totalCount').textContent = response.stats.total;
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

// 加载最近单词
async function loadRecentWords(query = '') {
  const wordList = document.getElementById('wordList');

  try {
    let response;
    if (query) {
      response = await chrome.runtime.sendMessage({
        action: 'searchWords',
        query: query
      });
    } else {
      response = await chrome.runtime.sendMessage({
        action: 'getWords',
        options: { limit: 10, orderBy: 'lastAccessedAt', order: 'desc' }
      });
    }

    if (response.success && response.words.length > 0) {
      const words = response.words;
      wordList.innerHTML = words.map(word => {
        const translation = word.translation || '';
        return `
        <div class="word-item" data-word="${escapeHtml(word.word)}" data-id="${word.id}">
          <div class="word-info">
            <span class="word-text">${escapeHtml(word.word)}</span>
            <span class="word-phonetic">${escapeHtml(word.phonetic || '')}</span>
            ${translation ? `<span class="word-translation">${escapeHtml(translation)}</span>` : ''}
          </div>
          <div class="word-meta">
            <span class="word-frequency">${word.frequency}次</span>
            <button class="btn-play" data-word="${escapeHtml(word.word)}" title="播放发音">
              ▶
            </button>
          </div>
        </div>
      `}).join('');

      // 绑定播放按钮事件
      wordList.querySelectorAll('.btn-play').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          playWord(btn.dataset.word);
        });
      });

      // 绑定单词条目点击 → 打开 Side Panel 显示详情
      wordList.querySelectorAll('.word-item').forEach(item => {
        item.addEventListener('click', async () => {
          const wordId = parseInt(item.dataset.id);
          if (!wordId) return;
          try {
            await chrome.storage.local.set({ pendingWordDetail: wordId });
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
              await chrome.sidePanel.open({ tabId: tab.id });
            }
            window.close();
          } catch (error) {
            console.error('Failed to open word detail:', error);
          }
        });
      });

      // 异步加载缺失的中文翻译
      loadMissingTranslations(words);
    } else {
      wordList.innerHTML = '<div class="word-list-empty">暂无单词记录</div>';
    }
  } catch (error) {
    console.error('Failed to load words:', error);
    wordList.innerHTML = '<div class="word-list-empty">加载失败</div>';
  }
}

// 播放单词发音
async function playWord(word) {
  try {
    await chrome.runtime.sendMessage({
      action: 'playOnly',
      word: word
    });
  } catch (error) {
    console.error('Failed to play word:', error);
  }
}

// 设置事件监听
function setupEventListeners() {
  // 搜索输入
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadRecentWords(e.target.value.trim());
    }, 300);
  });

  // 打开侧边栏
  document.getElementById('openSidePanel').addEventListener('click', async () => {
    try {
      // 获取当前窗口
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close();
      }
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  });
}

// 异步加载缺失的中文翻译
async function loadMissingTranslations(words) {
  const wordsNeedTranslation = words.filter(w => !w.translation);
  if (wordsNeedTranslation.length === 0) return;

  const BATCH_SIZE = 5;
  for (let i = 0; i < wordsNeedTranslation.length; i += BATCH_SIZE) {
    const batch = wordsNeedTranslation.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (word) => {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'translateWord',
          word: word.word
        });
        if (response.success && response.translation) {
          // 找到对应 DOM 元素，动态插入翻译
          const wordItem = document.querySelector(`.word-item[data-id="${word.id}"]`);
          if (wordItem) {
            const wordInfo = wordItem.querySelector('.word-info');
            // 避免重复添加
            if (!wordInfo.querySelector('.word-translation')) {
              const translationEl = document.createElement('span');
              translationEl.className = 'word-translation';
              translationEl.textContent = response.translation;
              wordInfo.appendChild(translationEl);
            }
          }
        }
      } catch (e) {
        // 翻译失败静默跳过
      }
    });
    await Promise.all(promises);
  }
}

// HTML 转义
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
