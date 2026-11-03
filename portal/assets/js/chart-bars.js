/**
 * Visible bar charts — uses pixel heights (percentage heights fail in flex layouts).
 */
function renderBarChart(container, items, options = {}) {
  if (!container) return;
  const maxH = options.maxHeight || 160;
  const color = options.color || 'linear-gradient(180deg, #34d399 0%, #059669 100%)';
  const altColor = options.altColor || 'linear-gradient(180deg, #60a5fa 0%, #2563eb 100%)';
  const valueKey = options.valueKey || 'value';
  const labelKey = options.labelKey || 'label';
  const useAlt = options.alternateColors;

  if (!items || !items.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem 1rem;font-size:0.9rem;">No chart data for this period.</p>';
    return;
  }

  container.innerHTML = items.map((item, i) => {
    const val = Math.min(100, Math.max(0, Number(item[valueKey]) || 0));
    const h = Math.max(14, Math.round((val / 100) * maxH));
    const bg = useAlt && i % 2 ? altColor : color;
    const label = String(item[labelKey] ?? '').replace(/</g, '&lt;');
    return `<div class="bar-item">
      <div class="bar chart-bar-visible" style="height:${h}px;background:${bg};" data-value="${val}%"></div>
      <span class="bar-label">${label}</span>
    </div>`;
  }).join('');
}
