// WordVoice 工具函数

// HTML 转义
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 格式化日期
export function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 获取域名
export function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// 检查是否为有效英文单词
export function isEnglishWord(text) {
  if (!text || typeof text !== 'string') return false;
  const cleaned = text.trim();
  return /^[a-zA-Z][a-zA-Z\s'-]*$/.test(cleaned);
}

// 防抖函数
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export default {
  escapeHtml,
  formatDate,
  getDomain,
  isEnglishWord,
  debounce
};
