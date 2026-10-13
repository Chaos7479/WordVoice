import { request } from './network.js';
export const TEXT_ENDPOINTS = {
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  minimax: 'https://api.minimax.cn/v1/chat/completions',
};
export async function complete(provider, config, system, text, timeoutMs = 8000) {
  const url = TEXT_ENDPOINTS[provider];
  if (!url) throw new Error('请选择有效的 AI 服务');
  if (!config.apiKey) throw new Error('请在设置中填写 API Key');
  if (!config.textModel) throw new Error('请在设置中填写模型名称或推理接入点 ID');
  const data = await request(url, {
    timeoutMs,
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.textModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
      max_tokens: 2048,
      ...(provider === 'minimax' ? { reasoning_split: true } : {}),
    }),
  });
  const result = data.choices?.[0]?.message?.content
    ?.replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  if (!result) throw new Error('服务返回空内容，请检查模型配置');
  return result;
}
