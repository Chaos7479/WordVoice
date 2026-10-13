// Keep the deadline active until the response body has been consumed.
export async function request(url, { timeoutMs = 5000, signal, format = 'json', ...options } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('请求超时，请检查网络或服务配置')),
    timeoutMs,
  );
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}，请检查网络和 API 配置`);
    return await (format === 'buffer' ? response.arrayBuffer() : response.json());
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason || error;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('已停止朗读', 'AbortError');
}

export function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
