import db from './db.js';
import { request } from './network.js';
import { getTextType } from './text.js';
const pending = new Map();
export async function cachedLookup(key, work, ttl = 7 * 86400000) {
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const cached = await db.getCache(key).catch(() => null);
    if (cached !== null) return cached;
    const value = await work();
    if (value && !value.fallback) await db.setCache(key, value, ttl).catch(() => {});
    return value;
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
export async function fetchWordData(text, pronunciation = 'us') {
  if (getTextType(text) !== 'word') return { definitions: [] };
  const word = text.toLowerCase();
  return cachedLookup(`dict:2:${pronunciation}:${word}`, async () => {
    const data = await request(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { timeoutMs: 3500 },
    );
    const entry = data?.[0];
    if (!entry) throw new Error('词典暂未收录');
    const phonetics = entry.phonetics || [];
    const preferred =
      phonetics.find((p) => p.audio?.includes(`-${pronunciation}`)) ||
      phonetics.find((p) => p.audio);
    return {
      phonetic: preferred?.text || entry.phonetic || phonetics.find((p) => p.text)?.text || '',
      audioUrl: preferred?.audio || '',
      definitions: (entry.meanings || [])
        .flatMap((m) =>
          (m.definitions || []).slice(0, 2).map((d) => ({
            partOfSpeech: m.partOfSpeech || '',
            meaning: d.definition || '',
            example: d.example || '',
          })),
        )
        .slice(0, 5),
    };
  });
}
