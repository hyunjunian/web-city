// Light or dark UI: follows the system unless the 도시 menu picks one (saved per browser).
// index.html applies the saved choice before the first paint; this keeps it up to date.

import { graphs, redraw, renderer } from './state';
import { $ } from './util';

const KEY = 'web-city:theme';
type Mode = 'system' | 'light' | 'dark';
const LABEL: Record<Mode, string> = { system: '시스템', light: '밝게', dark: '어둡게' };
const NEXT: Record<Mode, Mode> = { system: 'light', light: 'dark', dark: 'system' };
const media = matchMedia('(prefers-color-scheme: light)');

function mode(): Mode {
  try {
    const m = localStorage.getItem(KEY);
    return m === 'light' || m === 'dark' ? m : 'system';
  } catch {
    return 'system';
  }
}

function apply(): void {
  const m = mode();
  const light = m === 'light' || (m === 'system' && media.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#ffffff' : '#0a0a0b');
  $('#btn-theme .menu-label').textContent = `테마: ${LABEL[m]}`;
  renderer.background = getComputedStyle($('#view')).getPropertyValue('--view-bg').trim() || '#1b1d22'; // night's own (see style.css)
  graphs.redraw();
  redraw();
}

export function setupTheme(): void {
  $('#btn-theme').onclick = () => {
    try {
      localStorage.setItem(KEY, NEXT[mode()]);
    } catch { /* storage unavailable: the choice lasts this visit only */ }
    apply();
  };
  media.addEventListener('change', apply);
  apply();
}
