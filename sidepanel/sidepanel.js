// WordVoice Side Panel Script

let currentFilter = 'all';
let currentTypeFilter = 'words-phrases';
let currentSort = 'lastAccessedAt';
let allWords = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadWords();
  setupEventListeners();
  // 检查是否有从 Popup 跳转过来的单词详情请求
  await checkPendingWordDetail();
});

// 检查并处理从 Popup 点击跳转的单词详情
async function checkPendingWordDetail() {
  try {
    const result = await chrome.storage.local.get('pendingWordDetail');
    if (result.pendingWordDetail) {
      const wordId = result.pendingWordDetail;
      await chrome.storage.local.remove('pendingWordDetail');
      showWordDetail(wordId);
    }
  } catch (e) {
    // 静默跳过
  }
}

// 加载单词列表
async function loadWords() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getWords',
      options: { limit: 1000, orderBy: currentSort, order: currentSort === 'word' ? 'asc' : 'desc' }
    });

    if (response.success) {
      allWords = response.words;
      renderWords();
    }
  } catch (error) {
    console.error('Failed to load words:', error);
  }
}

// 渲染单词列表
function renderWords(searchQuery = '') {
  const wordList = document.getElementById('wordList');
  let words = filterWords(allWords, searchQuery);

  // 更新统计
  const wordCount = words.filter(w => (w.type || 'word') === 'word').length;
  const phraseCount = words.filter(w => w.type === 'phrase').length;
  const sentenceCount = words.filter(w => w.type === 'sentence').length;
  const parts = [`共 ${words.length} 条`];
  if (phraseCount > 0) parts.push(`${phraseCount} 短语`);
  if (sentenceCount > 0) parts.push(`${sentenceCount} 句子`);
  document.getElementById('statsText').textContent = parts.join(' · ');

  if (words.length === 0) {
    wordList.innerHTML = '<div class="word-list-empty">暂无单词记录</div>';
    return;
  }

  wordList.innerHTML = words.map(word => {
    const definition = word.definitions?.[0]?.meaning || '';
    const translation = word.translation || '';
    const wordType = word.type || 'word';
    const typeBadge = wordType === 'phrase'
      ? '<span class="word-type-badge word-type-badge--phrase">短语</span>'
      : wordType === 'sentence'
        ? '<span class="word-type-badge word-type-badge--sentence">句子</span>'
        : '';

    return `
      <div class="word-card" data-id="${word.id}">
        <div class="word-card-header">
          <div class="word-main">
            <div class="word-text-row">
              <span class="word-text">${escapeHtml(word.word)}</span>
              ${typeBadge}
            </div>
            <span class="word-phonetic">${escapeHtml(word.phonetic || '')}</span>
          </div>
          <div class="word-actions">
            <span class="word-frequency">${word.frequency}次</span>
            <button class="btn-play-small" data-word="${escapeHtml(word.word)}" title="播放发音">▶</button>
          </div>
        </div>
        ${translation ? `<div class="word-translation">${escapeHtml(translation)}</div>` : ''}
        ${definition ? `<div class="word-definition">${escapeHtml(definition)}</div>` : ''}
      </div>
    `;
  }).join('');

  // 绑定事件
  wordList.querySelectorAll('.word-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.btn-play-small')) {
        showWordDetail(parseInt(card.dataset.id));
      }
    });
  });

  wordList.querySelectorAll('.btn-play-small').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playWord(btn.dataset.word);
    });
  });

  // 异步加载缺少翻译的单词的中文释义
  loadMissingTranslations(words);
}

// 异步批量加载缺少翻译的单词的中文释义
async function loadMissingTranslations(words) {
  const wordsNeedTranslation = words.filter(w => !w.translation);
  if (wordsNeedTranslation.length === 0) return;

  // 每批处理 5 个，避免 API 限流
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
          // 更新内存中的数据
          word.translation = response.translation;
          // 找到对应的 DOM 元素并插入翻译
          const card = document.querySelector(`.word-card[data-id="${word.id}"]`);
          if (card && !card.querySelector('.word-translation')) {
            const translationEl = document.createElement('div');
            translationEl.className = 'word-translation';
            translationEl.textContent = response.translation;
            const header = card.querySelector('.word-card-header');
            if (header) {
              header.insertAdjacentElement('afterend', translationEl);
            }
          }
        }
      } catch (error) {
        // 翻译失败静默跳过
      }
    });
    await Promise.all(promises);
  }
}

// 过滤单词
function filterWords(words, searchQuery = '') {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;

  let filtered = words;

  // 应用类型筛选
  switch (currentTypeFilter) {
    case 'words-phrases':
      filtered = filtered.filter(w => (w.type || 'word') !== 'sentence');
      break;
    case 'word':
      filtered = filtered.filter(w => (w.type || 'word') === 'word');
      break;
    case 'phrase':
      filtered = filtered.filter(w => w.type === 'phrase');
      break;
    case 'sentence':
      filtered = filtered.filter(w => w.type === 'sentence');
      break;
    // 'all' — 不过滤
  }

  // 应用时间/掌握度筛选
  switch (currentFilter) {
    case 'today':
      filtered = filtered.filter(w => w.createdAt >= todayStart);
      break;
    case 'week':
      filtered = filtered.filter(w => w.createdAt >= weekStart);
      break;
    case 'new':
      filtered = filtered.filter(w => w.mastery === 'new');
      break;
    case 'mastered':
      filtered = filtered.filter(w => w.mastery === 'mastered');
      break;
    case 'learning':
      filtered = filtered.filter(w => w.mastery === 'learning');
      break;
  }

  // 应用搜索
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(w =>
      w.word.toLowerCase().includes(query) ||
      w.definitions?.some(d => d.meaning?.toLowerCase().includes(query))
    );
  }

  return filtered;
}

// 显示单词详情
async function showWordDetail(wordId) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getWordWithContexts',
      wordId: wordId
    });

    if (response.success && response.word) {
      const word = response.word;
      const detailPanel = document.getElementById('wordDetail');

      // 填充数据
      document.getElementById('detailWord').textContent = word.word;
      document.getElementById('detailPhonetic').textContent = word.phonetic || '';
      document.getElementById('detailFrequency').textContent = word.frequency;
      document.getElementById('detailFirstSeen').textContent = formatDate(word.createdAt);

      // 释义
      const definitionsEl = document.getElementById('detailDefinitions');
      if (word.definitions?.length > 0) {
        definitionsEl.innerHTML = word.definitions.map(def => `
          <div class="definition-item">
            <div class="definition-header-row">
              <div class="definition-pos">${escapeHtml(def.partOfSpeech || '')}</div>
              <button class="btn-speak-inline" data-text="${escapeHtml(def.meaning || '')}" title="朗读释义">&#x1f50a;</button>
            </div>
            <div class="definition-text">${escapeHtml(def.meaning || '')}</div>
            <div class="definition-translation" data-text="${escapeHtml(def.meaning || '')}"></div>
            ${def.example ? `
              <div class="definition-example-row">
                <div class="definition-example">"${escapeHtml(def.example)}"</div>
                <button class="btn-speak-inline" data-text="${escapeHtml(def.example)}" title="朗读例句">&#x1f50a;</button>
              </div>
              <div class="definition-example-translation" data-text="${escapeHtml(def.example)}"></div>
            ` : ''}
          </div>
        `).join('');

        // 绑定释义区发音按钮
        definitionsEl.querySelectorAll('.btn-speak-inline').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            playWord(btn.dataset.text);
          });
        });

        // 异步加载释义翻译
        loadDefinitionTranslations(definitionsEl);
      } else {
        // 短语/句子没有字典释义，显示翻译
        const wordType = word.type || 'word';
        if (wordType !== 'word') {
          const typeLabel = wordType === 'phrase' ? '短语' : '句子';
          const cachedTranslation = word.translation || '';
          definitionsEl.innerHTML = `
            <div class="definition-item">
              <div class="definition-header-row">
                <div class="definition-pos">${typeLabel}</div>
                <button class="btn-speak-inline" data-text="${escapeHtml(word.word)}" title="朗读">&#x1f50a;</button>
              </div>
              <div class="definition-translation" id="phraseTranslation">${escapeHtml(cachedTranslation)}</div>
            </div>
          `;
          definitionsEl.querySelectorAll('.btn-speak-inline').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              playWord(btn.dataset.text);
            });
          });
          // 如果没有缓存翻译，异步加载
          if (!cachedTranslation) {
            chrome.runtime.sendMessage({ action: 'translateWord', word: word.word }).then(resp => {
              if (resp.success && resp.translation) {
                const el = document.getElementById('phraseTranslation');
                if (el) el.textContent = resp.translation;
              }
            }).catch(() => {});
          }
        } else {
          definitionsEl.innerHTML = '<div class="word-list-empty">暂无释义</div>';
        }
      }

      // 上下文
      const contextsEl = document.getElementById('detailContexts');
      if (word.contexts?.length > 0) {
        contextsEl.innerHTML = word.contexts.map(ctx => `
          <div class="context-item">
            ${ctx.sentence ? `
              <div class="context-sentence-row">
                <div class="context-sentence">"${escapeHtml(ctx.sentence)}"</div>
                <button class="btn-speak-inline" data-text="${escapeHtml(ctx.sentence)}" title="朗读句子">&#x1f50a;</button>
              </div>
              <div class="context-sentence-translation" data-text="${escapeHtml(ctx.sentence)}"></div>
            ` : ''}
            <div class="context-source">
              <span>📄</span>
              ${ctx.pageUrl ? `<a href="${escapeHtml(ctx.pageUrl)}" target="_blank" title="${escapeHtml(ctx.pageTitle || ctx.pageUrl)}">${escapeHtml(ctx.pageTitle || getDomain(ctx.pageUrl))}</a>` : '未知来源'}
              <span>• ${formatDate(ctx.createdAt)}</span>
            </div>
          </div>
        `).join('');

        // 绑定上下文句子发音按钮
        contextsEl.querySelectorAll('.btn-speak-inline').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            playWord(btn.dataset.text);
          });
        });

        // 异步加载上下文句子翻译
        loadInlineTranslations(contextsEl, '.context-sentence-translation');
      } else {
        contextsEl.innerHTML = '<div class="word-list-empty">暂无上下文记录</div>';
      }

      // 绑定播放按钮
      document.getElementById('detailPlayBtn').onclick = () => playWord(word.word);

      // 绑定删除按钮
      document.getElementById('deleteBtn').onclick = () => deleteWord(word.id, word.word);

      // 重置 AI 例句区域
      document.getElementById('detailAiSentences').innerHTML =
        '<div class="ai-sentences-empty">点击「生成」按钮获取 AI 例句</div>';
      document.getElementById('generateSentencesBtn').onclick = () => generateAiSentences(word.word);

      // 显示详情面板
      detailPanel.style.display = 'flex';
    }
  } catch (error) {
    console.error('Failed to load word detail:', error);
  }
}

// 隐藏单词详情
function hideWordDetail() {
  document.getElementById('wordDetail').style.display = 'none';
}

// 删除单词
async function deleteWord(wordId, wordText) {
  if (!confirm(`确定要删除单词 "${wordText}" 吗？`)) return;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'deleteWord',
      wordId: wordId
    });

    if (response.success) {
      hideWordDetail();
      await loadWords();
    }
  } catch (error) {
    console.error('Failed to delete word:', error);
  }
}

// 播放发音
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

// 导出数据
async function exportData() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'exportData' });

    if (response.success) {
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wordvoice-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('Failed to export data:', error);
  }
}

// 导入数据
async function importData(file) {
  try {
    const text = await file.text();
    const jsonData = JSON.parse(text);

    const response = await chrome.runtime.sendMessage({
      action: 'importData',
      data: jsonData
    });

    if (response.success) {
      const { imported, merged, skipped } = response.stats;
      alert(`导入完成！\n新增单词: ${imported}\n合并单词: ${merged}\n跳过条目: ${skipped}`);
      await loadWords();
    } else {
      alert(`导入失败: ${response.error}`);
    }
  } catch (error) {
    console.error('Failed to import data:', error);
    alert(`导入失败: ${error.message}`);
  }
}

// 设置事件监听
function setupEventListeners() {
  // 类型筛选下拉
  document.getElementById('typeFilter').addEventListener('change', (e) => {
    currentTypeFilter = e.target.value;
    renderWords(document.getElementById('searchInput').value);
  });

  // 时间筛选标签
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderWords(document.getElementById('searchInput').value);
    });
  });

  // 排序选择
  document.getElementById('sortSelect').addEventListener('change', async (e) => {
    currentSort = e.target.value;
    await loadWords();
  });

  // 搜索输入
  let searchTimeout;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      renderWords(e.target.value.trim());
    }, 300);
  });

  // 返回按钮
  document.getElementById('backBtn').addEventListener('click', hideWordDetail);

  // 统计视图
  document.getElementById('statsViewBtn').addEventListener('click', showStatsView);
  document.getElementById('backFromStatsBtn').addEventListener('click', exitStatsView);

  // 统计卡片/图例点击 → 跳转单词列表并筛选
  document.querySelectorAll('.clickable-stat').forEach(el => {
    el.addEventListener('click', () => {
      const filter = el.dataset.filter;
      if (!filter) return;
      applyFilterAndShowList(filter);
    });
  });

  // 导入按钮
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  // 文件选择
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file);
      e.target.value = ''; // 清空文件选择，允许重复导入同一文件
    }
  });

  // 导出按钮
  document.getElementById('exportBtn').addEventListener('click', exportData);

  // 设置按钮 — 打开 options 页面
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 复习模式按钮
  document.getElementById('reviewModeBtn').addEventListener('click', startReview);

  // 返回单词本按钮
  document.getElementById('backToListBtn').addEventListener('click', exitReview);

  // 闪卡点击翻转
  document.getElementById('flashcard').addEventListener('click', flipCard);

  // 卡片播放按钮
  document.getElementById('cardPlayBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    playCard();
  });

  // 掌握度按钮
  document.getElementById('btnKnow').addEventListener('click', () => handleMastery('mastered'));
  document.getElementById('btnLearning').addEventListener('click', () => handleMastery('learning'));
  document.getElementById('btnUnknown').addEventListener('click', () => handleMastery('new'));

  // 重新开始复习
  document.getElementById('btnRestartReview').addEventListener('click', startReview);
}

// 工具函数
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ========== 视图切换 ==========

// 统一的视图切换函数，确保同一时间只有一个视图可见
function switchView(viewName) {
  const views = {
    wordList: document.getElementById('wordListView'),
    review: document.getElementById('reviewView'),
    stats: document.getElementById('statsView')
  };

  const titles = {
    wordList: '单词本',
    review: '复习模式',
    stats: '学习统计'
  };

  // 隐藏所有视图
  Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });

  // 显示目标视图
  if (views[viewName]) {
    views[viewName].style.display = 'flex';
  }

  // 更新标题
  document.getElementById('headerTitle').textContent = titles[viewName] || '单词本';
}

// 从统计视图跳转到单词列表并自动应用筛选
function applyFilterAndShowList(filter) {
  // 设置筛选条件
  currentFilter = filter;
  // 类型筛选重置为全部（统计包含所有类型）
  currentTypeFilter = 'all';
  document.getElementById('typeFilter').value = 'all';

  // 同步 UI 中的时间筛选标签高亮
  const timeFilters = ['all', 'today', 'week', 'new'];
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === (timeFilters.includes(filter) ? filter : 'all'));
  });

  // 切换到单词列表视图
  switchView('wordList');
  renderWords(document.getElementById('searchInput').value);
}

// ========== 复习模式功能 ==========

let reviewWords = [];
let currentCardIndex = 0;
let reviewStats = { know: 0, learning: 0, unknown: 0 };

// 开始复习
async function startReview() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getWordsForReview',
      limit: 20
    });

    if (response.success && response.words.length > 0) {
      // 复习只包含单词和短语，排除句子
      reviewWords = response.words.filter(w => (w.type || 'word') !== 'sentence');
      if (reviewWords.length === 0) {
        alert('暂无可复习的单词或短语');
        return;
      }
      currentCardIndex = 0;
      reviewStats = { know: 0, learning: 0, unknown: 0 };

      // 切换视图
      switchView('review');

      // 隐藏结束统计面板
      document.getElementById('reviewSummary').style.display = 'none';
      document.getElementById('flashcardContainer').style.display = 'flex';
      document.querySelector('.mastery-buttons').style.display = 'flex';

      // 显示第一张卡片
      showCard(0);
    } else {
      alert('暂无可复习的单词');
    }
  } catch (error) {
    console.error('Failed to start review:', error);
    alert('启动复习失败');
  }
}

// 退出复习
function exitReview() {
  switchView('wordList');
}

// 显示卡片
function showCard(index) {
  if (index >= reviewWords.length) {
    showReviewSummary();
    return;
  }

  const word = reviewWords[index];
  const flashcard = document.getElementById('flashcard');
  if (!flashcard) return;

  // 移除翻转状态
  flashcard.classList.remove('flipped');

  // 更新进度
  document.getElementById('reviewProgressText').textContent = `${index + 1}/${reviewWords.length}`;

  // 更新正面（单词）
  document.getElementById('cardWord').textContent = word.word;

  // 更新背面（单词 + 音标 + 释义）
  document.getElementById('cardBackWord').textContent = word.word;
  document.getElementById('cardPhonetic').textContent = word.phonetic || '';

  const definitionsEl = document.getElementById('cardDefinitions');
  if (word.definitions?.length > 0) {
    definitionsEl.innerHTML = word.definitions.map(def => `
      <div class="card-definition-item">
        <div class="card-definition-pos">${escapeHtml(def.partOfSpeech || '')}</div>
        <div class="card-definition-text">${escapeHtml(def.meaning || '')}</div>
        <div class="card-definition-zh" data-meaning="${escapeHtml(def.meaning || '')}"></div>
      </div>
    `).join('');
  } else {
    definitionsEl.innerHTML = '<div style="text-align: center; color: #aaa;">暂无释义</div>';
  }

  // 显示整体中文翻译（如果已有缓存）
  if (word.translation) {
    const firstZh = definitionsEl.querySelector('.card-definition-zh');
    if (firstZh) {
      firstZh.textContent = word.translation;
    }
  }

  // 异步加载每条释义的中文翻译
  loadCardTranslations(word, definitionsEl);
}

// 为闪卡背面每条英文释义加载中文翻译
async function loadCardTranslations(word, container) {
  const zhElements = container.querySelectorAll('.card-definition-zh');
  for (const el of zhElements) {
    const meaning = el.dataset.meaning;
    if (!meaning || el.textContent) continue;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translateWord',
        word: meaning
      });
      if (response.success && response.translation) {
        el.textContent = response.translation;
      }
    } catch (e) {
      // 静默跳过
    }
  }
}

// 翻转卡片
function flipCard() {
  const flashcard = document.getElementById('flashcard');
  flashcard.classList.toggle('flipped');
}

// 播放当前卡片发音
async function playCard() {
  const word = reviewWords[currentCardIndex];
  if (word) {
    await playWord(word.word);
  }
}

// 处理掌握度选择
async function handleMastery(mastery) {
  const word = reviewWords[currentCardIndex];
  if (!word) return;

  try {
    // 更新数据库
    await chrome.runtime.sendMessage({
      action: 'updateMastery',
      wordId: word.id,
      mastery: mastery
    });

    // 更新统计
    if (mastery === 'mastered') {
      reviewStats.know++;
    } else if (mastery === 'learning') {
      reviewStats.learning++;
    } else if (mastery === 'new') {
      reviewStats.unknown++;
    }

    // 显示下一张卡片
    currentCardIndex++;
    showCard(currentCardIndex);
  } catch (error) {
    console.error('Failed to update mastery:', error);
    alert('更新失败');
  }
}

// 显示复习结束统计
function showReviewSummary() {
  document.getElementById('flashcardContainer').style.display = 'none';
  document.querySelector('.mastery-buttons').style.display = 'none';

  document.getElementById('summaryKnow').textContent = reviewStats.know;
  document.getElementById('summaryLearning').textContent = reviewStats.learning;
  document.getElementById('summaryUnknown').textContent = reviewStats.unknown;

  document.getElementById('reviewSummary').style.display = 'block';
}

// ========== 统计视图功能 ==========

async function showStatsView() {
  switchView('stats');
  await loadStatsData();
}

function exitStatsView() {
  switchView('wordList');
}

async function loadStatsData() {
  try {
    const [statsResult, dailyResult, masteryResult] = await Promise.allSettled([
      chrome.runtime.sendMessage({ action: 'getStats' }),
      chrome.runtime.sendMessage({ action: 'getDailyStats', days: 14 }),
      chrome.runtime.sendMessage({ action: 'getMasteryStats' })
    ]);
    const statsResp = statsResult.status === 'fulfilled' ? statsResult.value : {};
    const dailyResp = dailyResult.status === 'fulfilled' ? dailyResult.value : {};
    const masteryResp = masteryResult.status === 'fulfilled' ? masteryResult.value : {};

    if (statsResp.success) {
      document.getElementById('overviewTotal').textContent = statsResp.stats.total;
      document.getElementById('overviewToday').textContent = statsResp.stats.today;
      document.getElementById('overviewWeek').textContent = statsResp.stats.week;
    }

    if (masteryResp.success) {
      renderMasteryChart(masteryResp.mastery);
    }

    if (dailyResp.success) {
      renderDailyChart(dailyResp.daily);
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function renderMasteryChart(mastery) {
  const { total, mastered, learning } = mastery;
  const newCount = mastery.new;

  document.getElementById('ringCenterLabel').textContent = total;
  document.getElementById('legendMastered').textContent = mastered;
  document.getElementById('legendLearning').textContent = learning;
  document.getElementById('legendNew').textContent = newCount;

  // SVG 环形图参数: stroke-dasharray = "弧段长度 间隔长度", stroke-dashoffset 控制起始偏移
  const circumference = 2 * Math.PI * 50; // r=50
  const safeTotal = total || 1;

  const masteredLen = (mastered / safeTotal) * circumference;
  const learningLen = (learning / safeTotal) * circumference;
  const newLen = (newCount / safeTotal) * circumference;

  const ringMastered = document.getElementById('ringMastered');
  const ringLearning = document.getElementById('ringLearning');
  const ringNew = document.getElementById('ringNew');

  // mastered: 从 12 点钟方向开始（SVG 已 rotate(-90deg)）
  ringMastered.style.strokeDasharray = `${masteredLen} ${circumference - masteredLen}`;
  ringMastered.style.strokeDashoffset = '0';

  // learning: 紧接 mastered 之后
  ringLearning.style.strokeDasharray = `${learningLen} ${circumference - learningLen}`;
  ringLearning.style.strokeDashoffset = `${-masteredLen}`;

  // new: 紧接 mastered + learning 之后
  ringNew.style.strokeDasharray = `${newLen} ${circumference - newLen}`;
  ringNew.style.strokeDashoffset = `${-(masteredLen + learningLen)}`;
}

function renderDailyChart(daily) {
  const container = document.getElementById('dailyChart');
  const maxCount = Math.max(...daily.map(d => d.count), 1);

  container.innerHTML = daily.map(d => {
    const heightPct = Math.max((d.count / maxCount) * 100, 2);
    return `
      <div class="daily-bar-group">
        <div class="daily-bar" style="height: ${heightPct}%;">
          <span class="daily-bar-count">${d.count}</span>
        </div>
        <span class="daily-bar-label">${d.date}</span>
      </div>
    `;
  }).join('');
}

// ========== AI 例句功能 ==========

async function generateAiSentences(word) {
  const btn = document.getElementById('generateSentencesBtn');
  const container = document.getElementById('detailAiSentences');

  btn.classList.add('loading');
  container.innerHTML = '<div class="ai-sentences-empty">正在生成例句...</div>';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'generateSentences',
      word: word
    });

    if (response.success && response.sentences?.length > 0) {
      container.innerHTML = response.sentences.map(sentence =>
        `<div class="ai-sentence-item">
          <div class="ai-sentence-row">
            <span class="ai-sentence-text">${escapeHtml(sentence)}</span>
            <button class="btn-speak-inline" data-text="${escapeHtml(sentence)}" title="朗读例句">&#x1f50a;</button>
          </div>
          <div class="ai-sentence-translation" data-text="${escapeHtml(sentence)}"></div>
        </div>`
      ).join('');

      // 绑定 AI 例句发音按钮
      container.querySelectorAll('.btn-speak-inline').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          playWord(btn.dataset.text);
        });
      });

      // 异步加载 AI 例句翻译
      loadInlineTranslations(container, '.ai-sentence-translation');
    } else {
      const errorMsg = response.error || '未能生成例句，请检查 AI 服务商配置';
      const isConfigError = errorMsg.includes('配置') || errorMsg.includes('API Key');
      container.innerHTML = `<div class="ai-sentence-error">${escapeHtml(errorMsg)}${isConfigError ? '<br><a class="ai-config-link" href="#">前往设置</a>' : ''}</div>`;
      container.querySelector('.ai-config-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }
  } catch (error) {
    const errorMsg = error.message || '生成失败';
    const isConfigError = errorMsg.includes('配置') || errorMsg.includes('API Key');
    container.innerHTML = `<div class="ai-sentence-error">${escapeHtml(errorMsg)}${isConfigError ? '<br><a class="ai-config-link" href="#">前往设置</a>' : ''}</div>`;
    container.querySelector('.ai-config-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  } finally {
    btn.classList.remove('loading');
  }
}

// ========== 翻译辅助函数 ==========

// 为释义区加载翻译（释义文本 + 例句）
async function loadDefinitionTranslations(container) {
  // 加载释义翻译
  const defTransEls = container.querySelectorAll('.definition-translation');
  for (const el of defTransEls) {
    const text = el.dataset.text;
    if (!text) continue;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translateWord',
        word: text
      });
      if (response.success && response.translation) {
        el.textContent = response.translation;
      }
    } catch (e) { /* 静默跳过 */ }
  }

  // 加载例句翻译
  const exTransEls = container.querySelectorAll('.definition-example-translation');
  for (const el of exTransEls) {
    const text = el.dataset.text;
    if (!text) continue;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translateWord',
        word: text
      });
      if (response.success && response.translation) {
        el.textContent = response.translation;
      }
    } catch (e) { /* 静默跳过 */ }
  }
}

// 通用内联翻译加载（AI 例句、上下文句子等）
async function loadInlineTranslations(container, selector) {
  const els = container.querySelectorAll(selector);
  for (const el of els) {
    const text = el.dataset.text;
    if (!text) continue;
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'translateWord',
        word: text
      });
      if (response.success && response.translation) {
        el.textContent = response.translation;
      }
    } catch (e) { /* 静默跳过 */ }
  }
}
