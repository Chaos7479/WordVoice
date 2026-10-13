export const MAX_TEXT_LENGTH = 2000;

export function normalizeText(value) {
  if (typeof value !== 'string') throw new Error('请先选中文本');
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text) throw new Error('请先选中文本');
  if (text.length > MAX_TEXT_LENGTH)
    throw new Error(`每次最多朗读 ${MAX_TEXT_LENGTH} 个字符，请缩短选区`);
  return text;
}

export function getTextType(text) {
  if (/^[a-zA-Z]+(?:[-’'][a-zA-Z]+)*$/.test(text)) return 'word';
  return /[.!?。！？]/u.test(text) || text.split(/\s+/u).length > 5 ? 'sentence' : 'phrase';
}

export function safePageUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href.slice(0, 4096) : '';
  } catch {
    return '';
  }
}

export function textField(value, max = 2000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function weekStart(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}
