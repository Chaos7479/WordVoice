import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete } from '../lib/llm.js';
import { normalizeSettings } from '../lib/settings.js';

const config = { apiKey: 'private-test-key', textModel: 'MiniMax-M3.1-Flash' };
test('MiniMax uses the native endpoint with bounded reasoning and excludes thinking from output', async () => {
  const original = fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.minimax.cn/v1/text/chatcompletion_v2');
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.textModel);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.reasoning_split, true);
    return new Response(
      JSON.stringify({
        base_resp: { status_code: 0 },
        choices: [
          { message: { content: '<think>hidden</think>解释', reasoning_content: 'hidden' } },
        ],
      }),
    );
  };
  try {
    assert.equal(
      await complete('minimax', config, 'test', 'database', 1000, { quick: true }),
      '解释',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('HTTP and native API failures expose safe actionable reasons, including successful HTTP envelopes', async () => {
  const original = fetch;
  const cases = [
    [200, { base_resp: { status_code: 2069, status_msg: config.apiKey } }, 'retired', /模型已停用/],
    [200, { base_resp: { status_code: 1008, status_msg: config.apiKey } }, 'quota', /余额/],
    [200, { base_resp: { status_code: 1004, status_msg: config.apiKey } }, 'auth', /Key 无效/],
    [
      200,
      { base_resp: { status_code: 2061, status_msg: config.apiKey } },
      'permission',
      /模型权限/,
    ],
    [200, { error: { code: 'invalid_api_key', message: config.apiKey } }, 'auth', /Key 无效/],
    [
      429,
      { error: { code: 'insufficient_quota', message: config.apiKey } },
      'quota',
      /额度.*HTTP 429/,
    ],
    [429, { error: { code: 'limit_requests', message: config.apiKey } }, 'rate', /限流.*HTTP 429/],
    [404, {}, 'endpoint', /接口地址.*HTTP 404/],
    [503, {}, 'unavailable', /暂不可用.*HTTP 503/],
    [401, 'non-JSON private-test-key', 'auth', /Key 无效.*HTTP 401/],
    [
      200,
      { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] },
      'truncated',
      /长度限制/,
    ],
    [200, { choices: [{ message: { content: {} } }] }, 'response', /格式无效/],
    [200, null, 'response', /格式无效/],
  ];
  try {
    for (const [status, data, code, message] of cases) {
      globalThis.fetch = async () =>
        new Response(typeof data === 'string' ? data : JSON.stringify(data), {
          status,
          headers: { 'Retry-After': '120' },
        });
      await assert.rejects(complete('minimax', config, 'test', 'test'), (error) => {
        assert.equal(error.code, code);
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, /private-test-key/);
        assert.equal(error.retryAfterMs, code === 'rate' ? 120000 : 0);
        return true;
      });
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('upgrades replace old default models while preserving credentials, speech and custom text models', () => {
  const saved = {
    providers: {
      qwen: { apiKey: 'qwen-key', textModel: 'qwen-turbo' },
      minimax: {
        apiKey: 'minimax-key',
        textModel: 'MiniMax-M2.5',
        model: 'speech-02-turbo',
        voiceId: 'custom-voice',
      },
    },
  };
  const settings = normalizeSettings(saved);
  assert.equal(settings.providers.qwen.textModel, 'qwen-flash');
  assert.equal(settings.providers.minimax.textModel, 'MiniMax-M3.1-Flash');
  assert.equal(settings.providers.qwen.apiKey, 'qwen-key');
  assert.equal(settings.providers.minimax.apiKey, 'minimax-key');
  assert.equal(settings.providers.minimax.model, 'speech-02-turbo');
  assert.equal(settings.providers.minimax.voiceId, 'custom-voice');
  assert.equal(saved.providers.minimax.textModel, 'MiniMax-M2.5');
  saved.providers.qwen.textModel = 'custom-qwen';
  saved.providers.minimax.textModel = 'custom-minimax';
  const custom = normalizeSettings(saved);
  assert.equal(custom.providers.qwen.textModel, 'custom-qwen');
  assert.equal(custom.providers.minimax.textModel, 'custom-minimax');
});
