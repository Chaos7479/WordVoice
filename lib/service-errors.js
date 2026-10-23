// Only fixed, actionable messages reach pages. Provider payloads can contain secrets.
const REASONS = {
  auth: 'Key 无效或已过期，请在设置中更新',
  permission: '当前账号无此模型权限，请更换模型或检查服务权限',
  quota: '额度或余额不足，请检查服务账户',
  rate: '请求限流，请稍后重试',
  retired: '模型已停用，请在设置中更换文本模型',
  model: '模型不存在或未开通，请检查文本模型配置',
  endpoint: '接口地址不可用，请更新扩展',
  timeout: '响应超时，请重试',
  unavailable: '服务暂不可用，请稍后重试',
  request: '请求参数不受支持，请检查模型配置',
  response: '返回内容格式无效，请重试或更换模型',
  truncated: '模型输出达到长度限制，请重试或更换模型',
  network: '网络连接失败，请检查网络和服务配置',
  unknown: '请求失败，请重试或检查配置',
};

export class ServiceError extends Error {
  constructor(reason, { status = 0, retryAfterMs = 0 } = {}) {
    const code = Object.hasOwn(REASONS, reason) ? reason : 'unknown';
    super(`${REASONS[code]}${status >= 400 && status <= 599 ? `（HTTP ${status}）` : ''}`);
    this.name = 'ServiceError';
    this.code = code;
    this.retryAfterMs =
      code === 'rate' ? Math.min(600000, Math.max(1000, retryAfterMs || 60000)) : 0;
  }
}

export function serviceError(data, status = 0, retryAfter = null) {
  const code = String(data?.error?.code ?? data?.base_resp?.status_code ?? '').toLowerCase();
  let reason;
  if (
    [
      '1008',
      '2053',
      '2067',
      'insufficient_quota',
      'arrearage',
      'allocationquota.freetieronly',
    ].includes(code)
  )
    reason = 'quota';
  else if (code === '2069') reason = 'retired';
  else if (['2022', 'modelnotfound', 'model_not_found', 'invalidmodel'].includes(code))
    reason = 'model';
  else if (['1004', '2049', 'invalid_api_key', 'invalidapikey'].includes(code) || status === 401)
    reason = 'auth';
  else if (['2061', '2068', 'accessdenied', 'modelaccessdenied'].includes(code) || status === 403)
    reason = 'permission';
  else if (
    [
      '1002',
      '1039',
      '1041',
      '1045',
      '2045',
      '2046',
      '2047',
      '2056',
      '2062',
      'limit_requests',
      'limit_tokens',
      'rate_limit_exceeded',
      'resourceexhausted',
    ].includes(code) ||
    code.startsWith('throttling.') ||
    status === 429
  )
    reason = 'rate';
  else if (['1001', '2066'].includes(code) || status === 408 || status === 504) reason = 'timeout';
  else if (status === 404) reason = 'endpoint';
  else if (code === '2013' || status === 400 || status === 422) reason = 'request';
  else if (['1000', '1024', '1033', '2064'].includes(code) || status >= 500) reason = 'unavailable';
  else reason = 'unknown';
  const retryAfterMs =
    retryAfter === null
      ? 0
      : /^\d+(?:\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
  return new ServiceError(reason, { status, retryAfterMs });
}

export function safeServiceError(error) {
  return error instanceof ServiceError ? error : new ServiceError('unknown');
}
