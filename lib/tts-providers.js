import { request, base64 } from './network.js';

export async function getProviderAudio(provider, config = {}, text, signal, language = 'en') {
  const options = {
    signal,
    timeoutMs: 5000,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (provider === 'dashscope') {
    if (!config.apiKey) throw new Error('请配置百炼 API Key');
    if (text.length > 600) throw new Error('百炼单次支持 600 个字符，已切换浏览器语音');
    const languages = {
      en: 'English',
      'zh-CN': 'Chinese',
      ja: 'Japanese',
      ko: 'Korean',
      fr: 'French',
      de: 'German',
      es: 'Spanish',
    };
    const data = await request(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model || 'qwen3-tts-flash',
          input: {
            text,
            voice: config.voice || 'Ethan',
            language_type: languages[language] || 'Auto',
          },
        }),
      },
    );
    const url = data.output?.audio?.url;
    if (!url) throw new Error('百炼返回空音频');
    return url;
  }
  if (provider === 'doubao') {
    if (!config.appId || !config.accessToken)
      throw new Error('请配置豆包 TTS App ID 和 Access Token');
    const data = await request('https://openspeech.bytedance.com/api/v1/tts', {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer;${config.accessToken}` },
      body: JSON.stringify({
        app: {
          appid: config.appId,
          token: config.accessToken,
          cluster: config.cluster || 'volcano_tts',
        },
        user: { uid: 'wordvoice' },
        audio: {
          voice_type: config.voiceType || 'BV056_streaming',
          encoding: 'mp3',
          speed_ratio: 1,
        },
        request: { reqid: crypto.randomUUID(), text, operation: 'query' },
      }),
    });
    if (data.code !== 3000 || !data.data)
      throw new Error(`豆包 TTS 请求失败（${data.code || '空音频'}）`);
    return `data:audio/mpeg;base64,${data.data}`;
  }
  if (provider === 'minimax') {
    if (!config.apiKey) throw new Error('请配置 MiniMax API Key');
    const query = config.groupId ? `?GroupId=${encodeURIComponent(config.groupId)}` : '';
    const data = await request(`https://api.minimax.cn/v1/t2a_v2${query}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model || 'speech-02-turbo',
        text,
        stream: false,
        voice_setting: {
          voice_id: config.voiceId || 'English_expressive_narrator_v2',
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
        output_format: 'hex',
      }),
    });
    if (data.base_resp?.status_code !== 0)
      throw new Error(`MiniMax TTS 请求失败（${data.base_resp?.status_code ?? '未知状态'}）`);
    const hex = data.data?.audio;
    if (typeof hex !== 'string' || !hex.length || hex.length % 2 || !/^[\da-f]+$/i.test(hex))
      throw new Error('MiniMax 返回无效音频');
    const bytes = Uint8Array.from(hex.match(/../g), (part) => parseInt(part, 16));
    return `data:audio/mpeg;base64,${base64(bytes.buffer)}`;
  }
  throw new Error('请选择有效的发音服务');
}
