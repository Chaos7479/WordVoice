import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeSettings } from '../lib/settings.js';
import { selectBrowserVoice, compatibleVoices } from '../lib/voices.js';

const voice = (voiceName, lang = 'en-US', remote = false) => ({ voiceName, lang, remote });
test('macOS alphabetical voice order does not select Albert for reading', () => {
  const voices = ['Albert', 'Bad News', 'Fred', 'Samantha', 'Whisper'].map((name) => voice(name));
  assert.equal(selectBrowserVoice(voices, DEFAULTS).voiceName, 'Samantha');
  assert.equal(selectBrowserVoice([...voices].reverse(), DEFAULTS).voiceName, 'Samantha');
});
test('automatic selection prefers local reading voices and enhanced variants', () => {
  assert.equal(
    selectBrowserVoice(
      [voice('Remote Natural', 'en-US', true), voice('Albert'), voice('Samantha')],
      DEFAULTS,
    ).voiceName,
    'Samantha',
  );
  assert.equal(
    selectBrowserVoice([voice('Samantha'), voice('Samantha (Enhanced)')], DEFAULTS).voiceName,
    'Samantha (Enhanced)',
  );
  assert.equal(
    selectBrowserVoice([voice('Albert'), voice('Remote Natural', 'en-US', true)], DEFAULTS)
      .voiceName,
    'Remote Natural',
  );
});
test('explicit voice is honored and unavailable voices fall back safely', () => {
  const voices = [voice('Alex'), voice('Samantha')];
  assert.equal(selectBrowserVoice(voices, { ...DEFAULTS, browserVoice: 'Alex' }).voiceName, 'Alex');
  assert.equal(
    selectBrowserVoice(voices, { ...DEFAULTS, browserVoice: 'Removed' }).voiceName,
    'Samantha',
  );
  assert.equal(normalizeSettings({ browserVoice: ' Alex ' }).browserVoice, 'Alex');
});
test('language and accent changes exclude incompatible saved voices', () => {
  const voices = [voice('Samantha'), voice('Daniel', 'en-GB'), voice('French', 'fr-FR')];
  assert.equal(
    selectBrowserVoice(voices, { ...DEFAULTS, pronunciation: 'uk', browserVoice: 'Samantha' })
      .voiceName,
    'Daniel',
  );
  assert.equal(
    selectBrowserVoice(voices, { ...DEFAULTS, sourceLanguage: 'fr', browserVoice: 'Samantha' })
      .voiceName,
    'French',
  );
  assert.equal(compatibleVoices(voices, { ...DEFAULTS, sourceLanguage: 'ja' }).length, 0);
});
test('empty and character-only lists delegate automatic selection to the system', () => {
  assert.equal(selectBrowserVoice([], DEFAULTS), undefined);
  assert.equal(selectBrowserVoice([voice('Albert'), voice('Zarvox')], DEFAULTS), undefined);
  assert.equal(
    selectBrowserVoice([voice('Albert')], { ...DEFAULTS, browserVoice: 'Albert' }).voiceName,
    'Albert',
  );
});
