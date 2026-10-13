import { complete } from './llm.js';
import { AI_PROVIDER_LIST, textServiceConfig } from './settings.js';
import { throwIfAborted } from './network.js';

const SPEED_KEY = 'textModelSpeeds';
const FRESH_MS = 10 * 60 * 1000;
let speedWrite = Promise.resolve();
function rememberSpeed(storage, key, sample) {
  if (!storage) return;
  speedWrite = speedWrite
    .catch(() => {})
    .then(async () => {
      const data = await storage.get(SPEED_KEY);
      const recent = Object.fromEntries(
        Object.entries(data[SPEED_KEY] || {}).filter(
          ([, value]) => Date.now() - value.time < FRESH_MS,
        ),
      );
      await storage.set({ [SPEED_KEY]: { ...recent, [key]: sample } });
    })
    .catch(() => {});
}
export function textCandidates(settings) {
  return AI_PROVIDER_LIST.map(({ id, name }) => ({
    id,
    name,
    config: textServiceConfig(settings, id),
  })).filter(({ config }) => config.apiKey && config.textModel);
}

// Cold requests race configured services. Warm requests give the recent winner a
// short head start. Only validated answers can win; all remaining work is aborted.
export async function fastestText(
  settings,
  system,
  text,
  parse,
  { signal, timeoutMs = 10000 } = {},
) {
  const candidates = textCandidates(settings);
  if (!candidates.length) throw new Error('请先配置 AI 服务 Key，再重试解释');
  const storage = globalThis.chrome?.storage?.session;
  await speedWrite;
  const speeds = (await storage?.get(SPEED_KEY).catch(() => ({})))?.[SPEED_KEY] || {};
  throwIfAborted(signal);
  const key = ({ id, config }) => `${id}:${config.textModel}`;
  const score = (candidate) => {
    const sample = speeds[key(candidate)];
    return sample && !sample.failed && Date.now() - sample.time < FRESH_MS ? sample.ms : Infinity;
  };
  candidates.sort((a, b) => score(a) - score(b));
  const lead = score(candidates[0]);
  const lastRace = Math.max(
    ...candidates.map((candidate) => {
      const sample = speeds[key(candidate)];
      return sample?.failed ? 0 : sample?.racedAt || sample?.time || 0;
    }),
  );
  const hedgeMs =
    Number.isFinite(lead) && Date.now() - lastRace < FRESH_MS
      ? Math.min(1800, Math.max(500, lead * 1.35))
      : 0;
  return new Promise((resolve, reject) => {
    const controllers = new Set();
    let next = 0;
    let failed = 0;
    let settled = false;
    let hedge;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(hedge);
      signal?.removeEventListener('abort', abort);
      for (const controller of controllers) controller.abort();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || new DOMException('已取消查询', 'AbortError'));
    const deadline = setTimeout(() => finish(new Error('AI 响应超时，请重试')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    function launch() {
      if (settled || next >= candidates.length) return;
      const candidate = candidates[next++];
      const controller = new AbortController();
      controllers.add(controller);
      const start = performance.now();
      complete(candidate.id, candidate.config, system, text, timeoutMs, {
        signal: controller.signal,
        quick: true,
      })
        .then(parse)
        .then((answer) => {
          if (settled) return;
          const ms = Math.round(performance.now() - start);
          const previous = speeds[key(candidate)];
          const sample = {
            ms: Number.isFinite(previous?.ms) ? Math.round(previous.ms * 0.3 + ms * 0.7) : ms,
            time: Date.now(),
            racedAt: hedgeMs ? previous?.racedAt || previous?.time || Date.now() : Date.now(),
          };
          // Store only model timing, never prompts, history or credentials.
          rememberSpeed(storage, key(candidate), sample);
          finish(null, {
            ...answer,
            model: candidate.config.textModel,
            provider: candidate.id,
            elapsedMs: ms,
          });
        })
        .catch(() => {
          if (settled) return;
          rememberSpeed(storage, key(candidate), { failed: true, time: Date.now() });
          failed++;
          if (failed === candidates.length) finish(new Error('AI 服务暂不可用，请重试或检查配置'));
          else launch();
        });
    }
    launch();
    const launchBackups = () => {
      while (!settled && next < candidates.length) launch();
    };
    if (hedgeMs) hedge = setTimeout(launchBackups, hedgeMs);
    else launchBackups();
  });
}
