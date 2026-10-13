import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

const source = process.argv[2];
if (!source) throw new Error('请提供包含语音服务 Key 的 .env 文件路径');
const env = parseEnv(await readFile(source, 'utf8'));
const providers = {};
if (env.DASHSCOPE_API_KEY)
  providers.dashscope = { apiKey: env.DASHSCOPE_API_KEY, model: 'qwen3-tts-flash', voice: 'Ethan' };
const minimaxKey = env.MINIMAX_API_KEY_PROD || env.MINIMAX_API_KEY || env.MINIMAX_API_KEY_TEST;
if (minimaxKey)
  providers.minimax = {
    apiKey: minimaxKey,
    model: 'speech-02-turbo',
    voiceId: 'English_expressive_narrator_v2',
  };
if (env.DOUBAO_TTS_APP_ID && env.DOUBAO_TTS_ACCESS_TOKEN)
  providers.doubao = { appId: env.DOUBAO_TTS_APP_ID, accessToken: env.DOUBAO_TTS_ACCESS_TOKEN };
if (!Object.keys(providers).length) throw new Error('文件中未找到支持的语音服务凭据');
await writeFile(
  'settings.local.json',
  JSON.stringify({ schema: 1, revision: randomUUID(), providers }, null, 2),
  { mode: 0o600 },
);
await chmod('settings.local.json', 0o600);
console.log(
  `已生成本机配置：${Object.keys(providers).join('、')}。重新加载此项目目录中的扩展后生效。`,
);
