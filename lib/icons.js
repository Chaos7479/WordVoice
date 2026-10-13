// Small, local SVGs keep controls consistent without a font or network dependency.
const paths = {
  wave: '<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  chart: '<path d="M5 20V11m7 9V4m7 16V8"/>',
  cards:
    '<rect x="6" y="5" width="14" height="17" rx="3"/><path d="M3 17V5a3 3 0 0 1 3-3h10m-6 9h6m-6 4h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  upload: '<path d="M12 15V3m-4 4 4-4 4 4M4 17v4h16v-4"/>',
};
export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.wave}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
  root.querySelectorAll('button[title]').forEach((el) => {
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.title);
  });
}
