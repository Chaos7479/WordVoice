export function renderMasteryChart(mastery) {
  const { total, mastered, learning } = mastery;
  const newCount = mastery.new;

  document.getElementById('ringCenterLabel').textContent = total;
  document.getElementById('legendMastered').textContent = mastered;
  document.getElementById('legendLearning').textContent = learning;
  document.getElementById('legendNew').textContent = newCount;

  // SVG 环形图参数: stroke-dasharray = "弧段长度 间隔长度", stroke-dashoffset 控制起始偏移
  const circumference = 2 * Math.PI * 50; // r=50
  const safeTotal = total || 1;

  const masteredLen = (mastered / safeTotal) * circumference;
  const learningLen = (learning / safeTotal) * circumference;
  const newLen = (newCount / safeTotal) * circumference;

  const ringMastered = document.getElementById('ringMastered');
  const ringLearning = document.getElementById('ringLearning');
  const ringNew = document.getElementById('ringNew');

  // mastered: 从 12 点钟方向开始（SVG 已 rotate(-90deg)）
  ringMastered.style.strokeDasharray = `${masteredLen} ${circumference - masteredLen}`;
  ringMastered.style.strokeDashoffset = '0';

  // learning: 紧接 mastered 之后
  ringLearning.style.strokeDasharray = `${learningLen} ${circumference - learningLen}`;
  ringLearning.style.strokeDashoffset = `${-masteredLen}`;

  // new: 紧接 mastered + learning 之后
  ringNew.style.strokeDasharray = `${newLen} ${circumference - newLen}`;
  ringNew.style.strokeDashoffset = `${-(masteredLen + learningLen)}`;
}

export function renderDailyChart(daily) {
  const container = document.getElementById('dailyChart');
  const maxCount = Math.max(...daily.map((d) => d.count), 1);

  container.innerHTML = daily
    .map((d) => {
      const heightPct = (d.count / maxCount) * 100;
      return `
      <div class="daily-bar-group" tabindex="0" aria-label="${d.date}：${d.count} 条新增记录" title="${d.date}：${d.count}">
        <div class="daily-bar" style="height: ${heightPct}%;">
          <span class="daily-bar-count">${d.count}</span>
        </div>
        <span class="daily-bar-label">${d.date}</span>
      </div>
    `;
    })
    .join('');
}
