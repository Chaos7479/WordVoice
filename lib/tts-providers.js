// WordVoice TTS 服务商适配器

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ============================================
// 阿里云百炼 DashScope TTS (Qwen3-TTS HTTP API)
// ============================================
// CosyVoice 仅支持 WebSocket，浏览器 WebSocket 无法设置自定义 header
// 改用 Qwen3-TTS HTTP API，支持标准 fetch + Authorization header

const DASHSCOPE_TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

async function dashscopeTTS(config, text) {
  const { apiKey, model, voice } = config;
  if (!apiKey) throw new Error('DashScope 未配置 API Key');

  // CosyVoice/Sambert 只支持 WebSocket，Chrome 扩展无法使用，自动切换到 Qwen TTS
  let usedModel = model || 'qwen3-tts-flash';
  let usedVoice = voice || 'Ethan';
  if (usedModel.startsWith('cosyvoice') || usedModel.startsWith('sambert')) {
    usedModel = 'qwen3-tts-flash';
    // CosyVoice 音色与 Qwen TTS 不兼容，使用默认英文音色
    usedVoice = 'Ethan';
  }

  const response = await fetch(DASHSCOPE_TTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: usedModel,
      input: {
        text,
        voice: usedVoice,
        language_type: 'en'
      }
    })
  });

  if (!response.ok) {
    let errDetail = '';
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const errJson = await response.json();
        errDetail = errJson.message || errJson.error?.message || JSON.stringify(errJson).substring(0, 200);
      } else {
        errDetail = (await response.text()).substring(0, 200);
      }
    } catch { errDetail = response.statusText; }
    throw new Error(`DashScope API ${response.status}: ${errDetail}`);
  }

  const data = await response.json();

  // 提取音频 URL (output.audio.url)
  const audioUrl = data.output?.audio?.url;
  if (!audioUrl) {
    throw new Error('DashScope 未返回音频 URL: ' + JSON.stringify(data).substring(0, 300));
  }

  // 下载音频并转换为 data URL
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`音频下载失败: ${audioResp.status}`);
  const audioBuffer = await audioResp.arrayBuffer();
  if (!audioBuffer || audioBuffer.byteLength === 0) throw new Error('DashScope 返回空音频');

  return `data:audio/wav;base64,${arrayBufferToBase64(audioBuffer)}`;
}

// ============================================
// 豆包 (火山引擎) TTS
// ============================================

async function doubaoTTS(config, text) {
  const { appId, accessToken, cluster, voiceType } = config;
  if (!appId || !accessToken) throw new Error('豆包 TTS 未配置 App ID 或 Access Token');

  const response = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer;${accessToken}`
    },
    body: JSON.stringify({
      app: { appid: appId, token: accessToken, cluster: cluster || 'volcano_tts' },
      user: { uid: 'wordvoice_user' },
      audio: { voice_type: voiceType || 'BV056_streaming', encoding: 'mp3', speed_ratio: 1.0 },
      request: { reqid: uuid(), text, operation: 'query' }
    })
  });

  const data = await response.json();
  if (data.code !== 3000 || !data.data) {
    throw new Error(data.message || '豆包 TTS 请求失败');
  }

  return `data:audio/mpeg;base64,${data.data}`;
}

// ============================================
// MiniMax TTS
// ============================================

async function minimaxTTS(config, text) {
  const { groupId, apiKey, voiceId, model } = config;
  if (!groupId || !apiKey) throw new Error('MiniMax TTS 未配置 Group ID 或 API Key');

  const response = await fetch(`https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'speech-01-turbo',
      text,
      stream: false,
      voice_setting: { voice_id: voiceId || 'English_expressive_narrator_v2', speed: 1.0, vol: 1.0, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' }
    })
  });

  const data = await response.json();
  if (data.base_resp?.status_code !== 0) {
    throw new Error(data.base_resp?.status_msg || 'MiniMax TTS 请求失败');
  }

  if (data.extra_info?.audio_file) {
    return data.extra_info.audio_file;
  }

  if (data.data?.audio) {
    const hex = data.data.audio;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:audio/mpeg;base64,${btoa(binary)}`;
  }

  throw new Error('MiniMax TTS 未返回音频数据');
}

// ============================================

const providers = { dashscope: dashscopeTTS, doubao: doubaoTTS, minimax: minimaxTTS };

export async function getProviderAudio(providerId, config, text) {
  const provider = providers[providerId];
  if (!provider) throw new Error(`不支持的 TTS 服务商: ${providerId}`);
  return provider(config, text);
}

export default { getProviderAudio };
