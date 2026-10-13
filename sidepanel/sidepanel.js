import {
  send,
  escapeHtml as esc,
  showStatus,
  play,
  displayWord,
  enableKeyboardClick,
  formatDate,
} from '../lib/ui.js';
import { safePageUrl } from '../lib/text.js';
import { renderMasteryChart, renderDailyChart } from './charts.js';
const $ = (id) => document.getElementById(id);
let filter = 'all',
  type = 'all',
  sort = 'lastAccessedAt',
  view = 'wordList';
let rows = [],
  listGeneration = 0,
  detailGeneration = 0,
  selectedWord = null;
let reviewWords = [],
  cardIndex = 0,
  reviewing = false,
  reviewGeneration = 0;
let reviewStats = { mastered: 0, learning: 0, new: 0 };
let busyReview = false;

async function loadWords(append = false) {
  const generation = ++listGeneration;
  try {
    const result = await send('getWords', {
      options: {
        query: $('searchInput').value.trim(),
        filter,
        type,
        orderBy: sort,
        order: sort === 'word' ? 'asc' : 'desc',
        limit: 100,
        offset: append ? rows.length : 0,
      },
    });
    if (generation !== listGeneration) return;
    rows = append ? rows.concat(result.words) : result.words;
    $('statsText').textContent = `共 ${result.total} 条 · 已显示 ${rows.length} 条`;
    const list = $('wordList');
    list.innerHTML = rows.length
      ? rows
          .map(
            (w) =>
              `<div class="word-card" data-id="${w.id}" role="button" aria-label="查看 ${esc(displayWord(w))}"><div class="word-card-header"><div class="word-main"><div class="word-text-row"><span class="word-text">${esc(displayWord(w))}</span><span class="word-type-badge">${{ word: '单词', phrase: '短语', sentence: '句子' }[w.type || 'word']}</span></div><span class="word-phonetic">${esc(w.phonetic)}</span></div><div class="word-actions"><span class="word-frequency">${w.frequency}次</span><button class="btn-play-small" title="播放发音" aria-label="朗读 ${esc(displayWord(w))}">▶</button></div></div>${w.translation ? `<div class="word-translation">${esc(w.translation)}</div>` : ''}${w.definitions?.[0]?.meaning ? `<div class="word-definition">${esc(w.definitions[0].meaning)}</div>` : ''}</div>`,
          )
          .join('')
      : '<div class="word-list-empty">没有匹配的记录。选中文本后按 S，即可加入单词本。</div>';
    if (rows.length < result.total)
      list.insertAdjacentHTML('beforeend', '<button id="loadMore">加载更多</button>');
    $('loadMore')?.addEventListener('click', (event) => {
      event.currentTarget.disabled = true;
      loadWords(true);
    });
    list.querySelectorAll('.word-card').forEach((el) => {
      const word = rows.find((w) => w.id === Number(el.dataset.id));
      el.onclick = () => showWordDetail(word.id);
      el.querySelector('button').onclick = (event) => {
        event.stopPropagation();
        play(displayWord(word), event.currentTarget);
      };
    });
    enableKeyboardClick(list);
  } catch (error) {
    showStatus(error.message, true);
  }
}
function switchView(next) {
  hideWordDetail();
  view = next;
  if (next !== 'review') {
    reviewing = false;
    reviewGeneration++;
  }
  for (const name of ['wordList', 'review', 'stats'])
    $(`${name}View`).style.display = name === next ? 'flex' : 'none';
  $('headerTitle').textContent = { wordList: '单词本', review: '复习模式', stats: '学习统计' }[
    next
  ];
}
function speakButton(text) {
  return `<button class="btn-speak-inline" data-text="${esc(text)}" title="朗读" aria-label="朗读">🔊</button>`;
}
function bindSpeak(container) {
  container.querySelectorAll('[data-text]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      play(button.dataset.text, button);
    };
  });
}
async function showWordDetail(id) {
  const generation = ++detailGeneration;
  try {
    const { word } = await send('getWordWithContexts', { wordId: id });
    if (generation !== detailGeneration) return;
    if (!word) {
      showStatus('词条已删除，请刷新列表', true);
      return;
    }
    selectedWord = word;
    $('wordDetail').style.display = 'flex';
    $('detailWord').textContent = displayWord(word);
    $('detailPhonetic').textContent = word.phonetic || '';
    $('detailFrequency').textContent = word.frequency;
    $('detailFirstSeen').textContent = formatDate(word.createdAt);
    $('detailTranslation').textContent = word.translation || '尚无翻译';
    $('refreshTranslation').disabled = false;
    $('detailDefinitions').innerHTML = word.definitions?.length
      ? word.definitions
          .map(
            (d) =>
              `<div class="definition-item"><div class="definition-header-row"><div class="definition-pos">${esc(d.partOfSpeech)}</div>${speakButton(d.meaning)}</div><div class="definition-text">${esc(d.meaning)}</div>${d.example ? `<div class="definition-example-row"><div class="definition-example">${esc(d.example)}</div>${speakButton(d.example)}</div>` : ''}</div>`,
          )
          .join('')
      : '<div class="word-list-empty">暂无词典释义，可查看上方翻译。</div>';
    $('detailContexts').innerHTML = word.contexts?.length
      ? word.contexts
          .map((c) => {
            const url = safePageUrl(c.pageUrl);
            return `<div class="context-item">${c.sentence ? `<div class="context-sentence-row"><div class="context-sentence">${esc(c.sentence)}</div>${speakButton(c.sentence)}</div>` : ''}<div class="context-source">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(c.pageTitle || new URL(url).hostname)}</a>` : '未记录来源'} · ${formatDate(c.createdAt)}</div></div>`;
          })
          .join('')
      : '<div class="word-list-empty">暂无上下文</div>';
    bindSpeak($('detailDefinitions'));
    bindSpeak($('detailContexts'));
    $('detailAiSentences').innerHTML =
      '<div class="ai-sentences-empty">点击「生成」获取 3 条例句。</div>';
    $('generateSentencesBtn').disabled = false;
    $('detailPlayBtn').onclick = (event) => play(displayWord(word), event.currentTarget);
    $('backBtn').focus();
  } catch (error) {
    showStatus(error.message, true);
  }
}
function hideWordDetail() {
  detailGeneration++;
  selectedWord = null;
  $('wordDetail').style.display = 'none';
}
async function refreshTranslation() {
  const word = selectedWord;
  const generation = detailGeneration;
  if (!word) return;
  $('refreshTranslation').disabled = true;
  try {
    const { translation } = await send('translateWord', {
      word: displayWord(word),
      wordId: word.id,
    });
    if (generation !== detailGeneration) return;
    $('detailTranslation').textContent = translation || '请在设置中启用翻译';
  } catch (error) {
    if (generation === detailGeneration) showStatus(error.message, true);
  } finally {
    if (generation === detailGeneration) $('refreshTranslation').disabled = false;
  }
}
async function generateExamples() {
  const word = selectedWord;
  const generation = detailGeneration;
  if (!word) return;
  $('generateSentencesBtn').disabled = true;
  $('detailAiSentences').textContent = '正在生成例句…';
  try {
    const { sentences } = await send('generateSentences', { word: displayWord(word) });
    if (generation !== detailGeneration) return;
    $('detailAiSentences').innerHTML = sentences
      .map(
        (s) =>
          `<div class="ai-sentence-item"><div class="ai-sentence-row"><span class="ai-sentence-text">${esc(s)}</span>${speakButton(s)}</div></div>`,
      )
      .join('');
    bindSpeak($('detailAiSentences'));
  } catch (error) {
    if (generation === detailGeneration) {
      $('detailAiSentences').textContent = error.message;
      const button = document.createElement('button');
      button.textContent = '前往设置';
      button.className = 'btn-generate';
      button.onclick = () => chrome.runtime.openOptionsPage();
      $('detailAiSentences').appendChild(button);
    }
  } finally {
    if (generation === detailGeneration) $('generateSentencesBtn').disabled = false;
  }
}
async function removeWord() {
  const word = selectedWord;
  if (!word || !confirm(`删除“${displayWord(word)}”及其上下文记录？`)) return;
  try {
    await send('deleteWord', { wordId: word.id });
    hideWordDetail();
    await loadWords();
    showStatus('已删除');
  } catch (error) {
    showStatus(error.message, true);
  }
}
async function exportData() {
  $('exportBtn').disabled = true;
  try {
    const { data } = await send('exportData');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `wordvoice-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showStatus(`已导出 ${data.words.length} 条记录`);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    $('exportBtn').disabled = false;
  }
}
async function importData(file) {
  $('importBtn').disabled = true;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('请选择小于 25 MB 的 JSON 备份');
    const data = JSON.parse(await file.text());
    const { stats } = await send('importData', { data });
    await loadWords();
    showStatus(
      `导入完成：新增 ${stats.imported} 条，合并 ${stats.merged} 条，跳过 ${stats.skipped} 条`,
    );
  } catch (error) {
    showStatus(`导入失败：${error.message}`, true);
  } finally {
    $('importBtn').disabled = false;
    $('importFile').value = '';
  }
}
async function startReview() {
  const generation = ++reviewGeneration;
  try {
    const { words } = await send('getWordsForReview', { limit: 20 });
    if (generation !== reviewGeneration) return;
    if (!words.length) {
      showStatus('请先保存单词或短语');
      return;
    }
    switchView('review');
    reviewing = true;
    reviewWords = words;
    cardIndex = 0;
    reviewStats = { mastered: 0, learning: 0, new: 0 };
    busyReview = false;
    $('reviewSummary').style.display = 'none';
    $('flashcardContainer').style.display = 'flex';
    document.querySelector('.mastery-buttons').style.display = 'flex';
    showCard();
  } catch (error) {
    showStatus(error.message, true);
  }
}
function showCard() {
  document
    .querySelector('.review-progress')
    .style.setProperty('--review-progress', `${(cardIndex / reviewWords.length) * 100}%`);
  if (cardIndex >= reviewWords.length) {
    reviewing = false;
    $('flashcardContainer').style.display = 'none';
    document.querySelector('.mastery-buttons').style.display = 'none';
    $('reviewSummary').style.display = 'block';
    $('summaryKnow').textContent = reviewStats.mastered;
    $('summaryLearning').textContent = reviewStats.learning;
    $('summaryUnknown').textContent = reviewStats.new;
    return;
  }
  const word = reviewWords[cardIndex];
  $('flashcard').classList.remove('flipped');
  $('flashcard').setAttribute('aria-pressed', 'false');
  $('reviewProgressText').textContent = `${cardIndex + 1}/${reviewWords.length}`;
  $('cardWord').textContent = displayWord(word);
  $('cardBackWord').textContent = displayWord(word);
  $('cardPhonetic').textContent = word.phonetic || '';
  $('cardDefinitions').innerHTML =
    `${word.translation ? `<div class="word-translation">${esc(word.translation)}</div>` : ''}${word.definitions?.map((d) => `<div class="card-definition-item"><div class="card-definition-pos">${esc(d.partOfSpeech)}</div><div class="card-definition-text">${esc(d.meaning)}</div></div>`).join('') || (word.translation ? '' : '<div>尚无释义，可返回详情页查询翻译。</div>')}`;
}
function flipCard() {
  $('flashcard').classList.toggle('flipped');
  $('flashcard').setAttribute('aria-pressed', String($('flashcard').classList.contains('flipped')));
}
async function grade(level) {
  if (busyReview || !reviewing) return;
  const word = reviewWords[cardIndex];
  if (!word) return;
  busyReview = true;
  const generation = reviewGeneration;
  document.querySelectorAll('.btn-mastery').forEach((b) => {
    b.disabled = true;
  });
  try {
    await send('updateMastery', { wordId: word.id, mastery: level });
    if (generation !== reviewGeneration || !reviewing) return;
    reviewStats[level]++;
    cardIndex++;
    showCard();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    busyReview = false;
    document.querySelectorAll('.btn-mastery').forEach((b) => {
      b.disabled = false;
    });
  }
}
async function loadStats() {
  try {
    const result = await send('getStatsSummary');
    $('overviewTotal').textContent = result.stats.total;
    $('overviewToday').textContent = result.stats.today;
    $('overviewWeek').textContent = result.stats.week;
    renderMasteryChart(result.mastery);
    renderDailyChart(result.daily);
  } catch (error) {
    showStatus(error.message, true);
  }
}
async function pendingDetail() {
  const result = await chrome.storage.local.get('pendingWordDetail');
  if (result.pendingWordDetail) {
    await chrome.storage.local.remove('pendingWordDetail');
    switchView('wordList');
    await showWordDetail(result.pendingWordDetail);
  }
}
document.addEventListener('DOMContentLoaded', () => {
  $('typeFilter').value = type;
  $('typeFilter').onchange = (event) => {
    type = event.target.value;
    loadWords();
  };
  $('sortSelect').onchange = (event) => {
    sort = event.target.value;
    loadWords();
  };
  document.querySelectorAll('.filter-tab').forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.filter;
      document
        .querySelectorAll('.filter-tab')
        .forEach((b) => b.classList.toggle('active', b === button));
      loadWords();
    };
  });
  let timer;
  $('searchInput').oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadWords(), 150);
  };
  $('backBtn').onclick = hideWordDetail;
  $('detailPlayBtn').setAttribute('aria-label', '朗读当前文本');
  $('refreshTranslation').onclick = refreshTranslation;
  $('generateSentencesBtn').onclick = generateExamples;
  $('deleteBtn').onclick = removeWord;
  $('statsViewBtn').onclick = () => {
    switchView('stats');
    loadStats();
  };
  $('backFromStatsBtn').onclick = $('backToListBtn').onclick = () => {
    switchView('wordList');
    loadWords();
  };
  document.querySelectorAll('.clickable-stat').forEach((button) => {
    button.setAttribute('role', 'button');
    button.onclick = () => {
      filter = button.dataset.filter;
      type = 'all';
      $('typeFilter').value = type;
      $('searchInput').value = '';
      document
        .querySelectorAll('.filter-tab')
        .forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
      switchView('wordList');
      loadWords();
    };
  });
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = (event) => {
    if (event.target.files[0]) importData(event.target.files[0]);
  };
  $('exportBtn').onclick = exportData;
  $('settingsBtn').onclick = () => chrome.runtime.openOptionsPage();
  $('stopSpeech').onclick = () =>
    send('stopSpeech').catch((error) => showStatus(error.message, true));
  $('reviewModeBtn').onclick = $('btnRestartReview').onclick = startReview;
  $('flashcard').onclick = flipCard;
  $('flashcard').setAttribute('role', 'button');
  $('flashcard').setAttribute('aria-label', '翻转复习卡片');
  $('cardPlayBtn').onclick = (event) => {
    event.stopPropagation();
    const word = reviewWords[cardIndex];
    if (word) play(displayWord(word), event.currentTarget);
  };
  $('btnKnow').onclick = () => grade('mastered');
  $('btnLearning').onclick = () => grade('learning');
  $('btnUnknown').onclick = () => grade('new');
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideWordDetail();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'dataChanged') {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (view === 'wordList') loadWords();
        else if (view === 'stats') loadStats();
      }, 100);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pendingWordDetail?.newValue)
      pendingDetail().catch((error) => showStatus(error.message, true));
  });
  enableKeyboardClick();
  loadWords();
  pendingDetail().catch((error) => showStatus(error.message, true));
});
