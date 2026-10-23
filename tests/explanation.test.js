import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../lib/settings.js';
import { fastestText } from '../lib/fastest-text.js';
import { explainSelection, explanationInput, limitExplanation } from '../lib/explanation.js';

let session;
beforeEach(() => {
  const data = {};
  session = data;
  globalThis.chrome = {
    storage: {
      session: {
        get: async (key) => ({ [key]: data[key] }),
        set: async (value) => Object.assign(data, value),
      },
    },
  };
});
const settings = () =>
  normalizeSettings({
    providers: {
      dashscope: { apiKey: 'qwen-private-test-key' },
      minimax: { apiKey: 'minimax-private-test-key' },
    },
  });
const response = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const delayed = (ms, signal, value, onAbort = () => {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(response(value)), ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        onAbort();
        reject(signal.reason);
      },
      { once: true },
    );
  });
const answer = JSON.stringify({
  translation: '数据库',
  explanation: '数据库是按一定结构组织和保存信息的系统，方便查询、更新和管理。',
});

test('cold selection races configured models, returns the fastest answer and aborts the loser', async () => {
  const original = fetch;
  const calls = [];
  let aborted = false;
  globalThis.fetch = (url, options) => {
    calls.push(url);
    return delayed(url.includes('dashscope') ? 1000 : 10, options.signal, answer, () => {
      aborted = true;
    });
  };
  try {
    const result = await explainSelection({ word: 'database' }, settings());
    assert.equal(result.provider, 'minimax');
    assert.equal(result.translation, '数据库');
    assert.equal(calls.length, 2);
    assert.equal(aborted, true);
    assert.doesNotMatch(JSON.stringify(session), /private-test-key|数据库/);
  } finally {
    globalThis.fetch = original;
  }
});

test('a recent fast model runs alone; failure immediately tries another model', async () => {
  session.textModelSpeeds = { 'qwen:qwen-flash': { ms: 40, time: Date.now() } };
  const original = fetch;
  const calls = [];
  let fail = false;
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (fail && url.includes('dashscope')) return new Response('', { status: 429 });
    return response(answer);
  };
  try {
    assert.equal((await explainSelection({ word: 'database' }, settings())).provider, 'qwen');
    assert.equal(calls.length, 1);
    fail = true;
    assert.equal((await explainSelection({ word: 'database' }, settings())).provider, 'minimax');
    assert.equal(calls.length, 3);
    assert.equal((await explainSelection({ word: 'database' }, settings())).provider, 'minimax');
    assert.equal(calls.length, 4);
    assert.match(calls.at(-1), /minimax/);
  } finally {
    globalThis.fetch = original;
  }
});

test('periodic comparison discovers a faster model despite a recently used winner', async () => {
  session.textModelSpeeds = {
    'qwen:qwen-flash': { ms: 10, time: Date.now(), racedAt: Date.now() - 660000 },
    'minimax:MiniMax-M3.1-Flash': { ms: 100, time: Date.now(), racedAt: Date.now() - 660000 },
  };
  const original = fetch;
  const calls = [];
  globalThis.fetch = (url, options) => {
    calls.push(url);
    return delayed(url.includes('dashscope') ? 200 : 5, options.signal, answer);
  };
  try {
    assert.equal((await explainSelection({ word: 'database' }, settings())).provider, 'minimax');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('a slow recent winner starts a hedge and can be replaced before its timeout', async () => {
  session.textModelSpeeds = { 'qwen:qwen-flash': { ms: 40, time: Date.now() } };
  const original = fetch;
  let aborted = false;
  globalThis.fetch = (url, options) =>
    delayed(url.includes('dashscope') ? 5000 : 5, options.signal, answer, () => {
      aborted = true;
    });
  try {
    const start = performance.now();
    assert.equal((await explainSelection({ word: 'database' }, settings())).provider, 'minimax');
    assert.ok(performance.now() - start < 1500);
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('malformed fast responses cannot beat a valid model; history and notes remain bounded', async () => {
  const original = fetch;
  const bodies = [];
  globalThis.fetch = (url, options) => {
    bodies.push(JSON.parse(options.body));
    return delayed(
      url.includes('dashscope') ? 1 : 10,
      options.signal,
      url.includes('dashscope') ? 'wrong format' : answer,
    );
  };
  const history = Array.from({ length: 9 }, (_, i) => ({
    explanation: `上一条 ${i}`,
    note: '先解释术语',
    direction: 'simpler',
  }));
  try {
    const result = await explainSelection(
      {
        word: 'database',
        sentence: 'a database',
        direction: 'deeper',
        note: '用 Git 举例',
        history,
      },
      settings(),
    );
    assert.equal(result.provider, 'minimax');
    assert.equal(result.translation, '');
    const input = JSON.parse(bodies[0].messages[1].content);
    assert.equal(input.note, '用 Git 举例');
    assert.equal(input.previousExplanations.length, 6);
    assert.equal(input.previousExplanations.at(-1).explanation, '上一条 8');
    assert.match(bodies[0].messages[0].content, /太浅/);
    assert.equal(bodies[0].enable_thinking, false);
    assert.equal(
      explanationInput({ word: 'hello', direction: '__proto__', history: [null, {}] }).direction,
      'initial',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('explanations fit 140 Unicode characters and prefer complete sentences', () => {
  const first = `${'定义'.repeat(30)}。`;
  assert.equal(limitExplanation(first + '更多'.repeat(100)), first);
  assert.equal([...limitExplanation('🙂'.repeat(200))].length, 140);
  assert.ok(limitExplanation('🙂'.repeat(200)).endsWith('…'));
  assert.equal(limitExplanation('  简单\n解释。 '), '简单 解释。');
});

test('deadline and caller cancellation abort every pending request', async () => {
  const original = fetch;
  let aborted = 0;
  globalThis.fetch = (url, options) =>
    delayed(5000, options.signal, answer, () => {
      aborted++;
    });
  try {
    await assert.rejects(
      fastestText(settings(), 'test', 'test', JSON.parse, { timeoutMs: 30 }),
      /超时/,
    );
    assert.equal(aborted, 2);
    const controller = new AbortController();
    const task = explainSelection({ word: 'hello' }, settings(), { signal: controller.signal });
    setTimeout(() => controller.abort(new DOMException('用户关闭', 'AbortError')), 20);
    await assert.rejects(task, /用户关闭/);
    assert.equal(aborted, 4);
    await assert.rejects(
      explainSelection({ word: 'hello' }, settings(), { signal: controller.signal }),
      /用户关闭/,
    );
    assert.equal(aborted, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test('missing keys and failed services produce actionable errors without credentials', async () => {
  await assert.rejects(explainSelection({ word: 'hello' }, normalizeSettings()), /配置 AI/);
  const original = fetch;
  globalThis.fetch = async () => {
    throw new Error('private-test-key');
  };
  try {
    await assert.rejects(explainSelection({ word: 'hello' }, settings()), (error) => {
      assert.match(error.message, /检查配置/);
      assert.doesNotMatch(error.message, /private-test-key/);
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('rate limits and retired models retain individual causes; cooldown skips requests until expiry', async () => {
  const original = fetch;
  const calls = [];
  let recovered = false;
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.includes('dashscope'))
      return recovered
        ? response(answer)
        : new Response(
            JSON.stringify({
              error: {
                code: 'limit_requests',
                message: 'qwen-private-test-key',
              },
            }),
            { status: 429, headers: { 'Retry-After': '90' } },
          );
    return new Response(
      JSON.stringify({ base_resp: { status_code: 2069, status_msg: 'minimax-private-test-key' } }),
    );
  };
  const check = (error) => {
    assert.match(error.message, /通义千问：请求限流/);
    assert.match(error.message, /MiniMax：模型已停用/);
    assert.doesNotMatch(error.message, /private-test-key/);
    return true;
  };
  try {
    await assert.rejects(explainSelection({ word: 'database' }, settings()), check);
    assert.equal(calls.length, 2);
    await assert.rejects(explainSelection({ word: 'database' }, settings()), check);
    assert.equal(calls.length, 3);
    assert.match(calls.at(-1), /chatcompletion_v2/);
    assert.ok(session.textModelSpeeds['qwen:qwen-flash'].retryAt > Date.now() + 85000);
    assert.doesNotMatch(JSON.stringify(session), /private-test-key|database/);
    session.textModelSpeeds['qwen:qwen-flash'].retryAt = Date.now() - 1;
    recovered = true;
    assert.equal((await explainSelection({ word: 'database' }, settings())).provider, 'qwen');
  } finally {
    globalThis.fetch = original;
  }
});

test('a single rate-limited model fails promptly during cooldown without resending', async () => {
  const original = fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('', { status: 429 });
  };
  const onlyQwen = normalizeSettings({ providers: { qwen: { apiKey: 'test-key' } } });
  try {
    for (let i = 0; i < 2; i++)
      await assert.rejects(explainSelection({ word: 'hello' }, onlyQwen), /限流/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('deadline preserves an earlier service failure alongside the pending model timeout', async () => {
  const original = fetch;
  let aborted = false;
  globalThis.fetch = (url, options) =>
    url.includes('dashscope')
      ? Promise.resolve(new Response('', { status: 429 }))
      : delayed(5000, options.signal, answer, () => {
          aborted = true;
        });
  try {
    await assert.rejects(
      explainSelection({ word: 'hello' }, settings(), { timeoutMs: 40 }),
      (error) => {
        assert.match(error.message, /通义千问：.*429/);
        assert.match(error.message, /MiniMax：.*超时/);
        return true;
      },
    );
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = original;
  }
});
