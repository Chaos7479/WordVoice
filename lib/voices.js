// Chrome's voice list is not ranked by speech quality. macOS can list Albert first.
const CHARACTER_VOICES = new Set([
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'fred',
  'good news',
  'hysterical',
  'jester',
  'junior',
  'kathy',
  'organ',
  'ralph',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
]);
const READING_VOICES = ['samantha', 'alex', 'daniel', 'karen', 'moira', 'rishi', 'tessa'];
const nameOf = (voice) => (voice.voiceName || '').split(' (')[0].toLowerCase();
export const isCharacterVoice = (voice) => CHARACTER_VOICES.has(nameOf(voice));
export function voiceLanguage(settings) {
  return settings.sourceLanguage === 'en'
    ? settings.pronunciation === 'uk'
      ? 'en-GB'
      : 'en-US'
    : settings.sourceLanguage;
}
export function compatibleVoices(voices, settings) {
  const lang = voiceLanguage(settings).toLowerCase();
  const named = voices.filter((voice) => voice.voiceName);
  const exact = named.filter((voice) => voice.lang?.toLowerCase() === lang);
  return exact.length
    ? exact
    : named.filter((voice) => voice.lang?.toLowerCase().split('-')[0] === lang.split('-')[0]);
}
export function selectBrowserVoice(voices, settings) {
  const compatible = compatibleVoices(voices, settings);
  const explicit = compatible.find((voice) => voice.voiceName === settings.browserVoice);
  if (explicit) return explicit;
  const normal = compatible.filter((voice) => !isCharacterVoice(voice));
  const local = normal.filter((voice) => !voice.remote);
  const candidates = local.length ? local : normal;
  return (
    candidates.find((voice) => /\b(premium|enhanced|natural|neural)\b/i.test(voice.voiceName)) ||
    READING_VOICES.map((name) => candidates.find((voice) => nameOf(voice) === name)).find(
      Boolean,
    ) ||
    candidates[0]
  );
}
