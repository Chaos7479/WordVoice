let current = null;
function stop() {
  if (!current) return;
  current.cancel();
  current = null;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'offscreen') return false;
  if (message.action === 'stop') {
    stop();
    respond({ success: true });
    return false;
  }
  if (message.action !== 'play') return false;
  stop();
  if (
    typeof message.url !== 'string' ||
    !/^data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(message.url)
  ) {
    respond({ success: false, error: '音频格式无效' });
    return false;
  }
  const audio = new Audio(message.url);
  audio.playbackRate = Math.max(0.5, Math.min(2, Number(message.rate) || 1));
  let answered = false;
  let timer;
  const reply = (value) => {
    if (!answered) {
      answered = true;
      clearTimeout(timer);
      respond(value);
    }
  };
  const release = () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };
  const job = {
    cancel() {
      reply({ success: false, cancelled: true, error: '已停止朗读' });
      release();
    },
  };
  current = job;
  audio.onended = () => {
    if (current === job) {
      release();
      current = null;
    }
  };
  audio.onerror = () => {
    reply({ success: false, error: '音频播放失败' });
    if (current === job) {
      release();
      current = null;
    }
  };
  timer = setTimeout(() => {
    if (current === job) stop();
  }, 4000);
  audio
    .play()
    .then(() => reply({ success: true }))
    .catch((error) => {
      reply({ success: false, error: error.message });
      if (current === job) {
        release();
        current = null;
      }
    });
  return true;
});
