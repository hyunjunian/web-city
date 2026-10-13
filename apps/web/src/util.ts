// Small DOM and formatting helpers, and the hint-bar flash message. No imports:
// every other module may use these while it loads.

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

export const short = (v: number) => (Math.abs(v) >= 10_000 ? `${(v / 1000).toFixed(0)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : fmt(v));

/** Centi-hours as "1시간 05분". */
export const hours = (cu: number | null) => {
  if (cu === null) return '<span class="neg">2.5시간 안에 없음</span>';
  const m = Math.round(cu * 0.6);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${String(m % 60).padStart(2, '0')}분` : `${m}분`;
};

export const pct = (v: number) => `${Math.round(v * 100)}%`;

let flashTimer = 0;
/** What the hint bar shows again once a flash message has had its time (set by the map input). */
let restoreHint = (): void => {};

export function onHintRestore(fn: () => void): void {
  restoreHint = fn;
}

let flashShown = 0;
let flashTone: 'info' | 'bad' = 'info';

/**
 * An informative message (not a warning) that has been read long enough to give
 * way to the pointer's next reading: a placed facility's note must not hide the
 * next spot's warnings.
 */
export const flashYields = (): boolean => flashTimer !== 0 && flashTone === 'info' && performance.now() - flashShown > 900;

/** True while a flash message is showing. */
export const flashing = (): boolean => flashTimer !== 0;

/** A touch screen without a hovering pointer (a phone or tablet). */
/**
 * Whether a key belongs to the control it was pressed in rather than to the game:
 * anything typed into a text field or list; on a slider or a tab bar, only the
 * keys that move it (a clicked tax slider or sheet tab used to swallow Space,
 * 0–3, tool keys and Ctrl+Z).
 */
export function keyForControl(e: KeyboardEvent): boolean {
  const el = e.target as Element;
  const moving = /^(Arrow|Page|Home$|End$)/.test(e.key);
  if (el.closest?.('input[type="range"], [role="tablist"]')) return moving || (e.key === 'Escape' && !!el.closest('[role="tablist"]'));
  if (el.closest?.('input[type="checkbox"]')) return e.key === ' ';
  return !!el.closest?.('input, select, textarea');
}

export const touchFirst = (): boolean => matchMedia('(pointer: coarse) and (hover: none)').matches;

/** Ends a flash message now (another tool's hints take the bar). */
export function endFlash(): void {
  if (!flashTimer) return;
  clearTimeout(flashTimer);
  flashTimer = 0;
  delete $('#hint').dataset.tone;
}

/** Where a refusal goes when the hint bar is covered (set up by main: a toast). */
let coveredSay: ((msg: string) => void) | null = null;
export const onCoveredFlash = (say: (msg: string) => void) => { coveredSay = say; };

/** Shows a message in the hint bar for a few seconds (longer for long ones). */
export function flash(msg: string, tone: 'info' | 'bad' = 'info'): void {
  const hint = $('#hint');
  hint.textContent = glue(msg);
  // A refusal the hint bar can't show — under a phone's city sheet or a card, where the press was — is said by a
  // toast too (on a phone a widen or a build short of money did nothing anyone could see).
  if (tone === 'bad' && coveredSay) {
    const r = hint.getBoundingClientRect();
    const over = r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    const cover = over?.closest('#pane, #info-card, #sheet, #tray, dialog');
    // (Not a pane on its way out: the hint is in sight a moment later, and the same words came twice.)
    if (cover && !(cover.id === 'pane' && !document.getElementById('app')?.classList.contains('pane-open'))) coveredSay(msg);
  }
  hint.dataset.tone = tone;
  // Read out too (the hint bar itself changes with every hover, so it isn't a live region).
  const sr = document.getElementById('sr-status');
  if (sr) sr.textContent = msg;
  flashTone = tone;
  flashShown = performance.now();
  clearTimeout(flashTimer);
  // Long messages stay up longer.
  flashTimer = window.setTimeout(() => {
    flashTimer = 0;
    delete hint.dataset.tone;
    restoreHint();
  }, Math.min(6000, 2000 + msg.length * 40));
}

/**
 * A Korean particle after a word: the first form after a final consonant
 * (받침), the second after a vowel — josa('도시', '을', '를') → '를'. Words
 * not ending in Hangul (names in Latin letters, digits) get "a(b)".
 * For (으)로, a final ㄹ takes 로 like a vowel.
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return withFinal === '으로' ? '(으)로' : `${withFinal}(${withoutFinal})`;
  const final = (c - 0xac00) % 28;
  if (withFinal === '으로' && final === 8) return withoutFinal; // ㄹ받침 + 로
  return final ? withFinal : withoutFinal;
}

/** Text made safe to place in HTML, attributes included (names come from players and shared save files). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Money with the sign before the § (−§2,471), as the budget writes it. */
export function money(v: number): string {
  return `${v < 0 ? '−' : ''}§${fmt(Math.abs(v))}`;
}

let askDialog: HTMLDialogElement | null = null;

/**
 * Asks before something that can't be taken back, in the app's own dialog
 * (the browser's confirm says only 확인/취소): its button names the action.
 */
export function ask(text: string, action: string): Promise<boolean> {
  if (!askDialog) {
    askDialog = document.createElement('dialog');
    askDialog.id = 'ask-dialog';
    askDialog.setAttribute('aria-labelledby', 'ask-title');
    askDialog.setAttribute('aria-describedby', 'ask-text');
    askDialog.innerHTML = '<form method="dialog"><h2 class="ask-title" id="ask-title"></h2><p class="ask-text" id="ask-text"></p><menu><button value="cancel">취소</button><button value="ok" class="primary"></button></menu></form>';
    document.body.append(askDialog);
  }
  const d = askDialog;
  // Headed by what it would do, like the other dialogs' titles.
  d.querySelector('.ask-title')!.textContent = action;
  d.querySelector('.ask-text')!.textContent = text;
  d.querySelector('button[value="ok"]')!.textContent = action;
  d.returnValue = '';
  d.showModal();
  d.querySelector<HTMLButtonElement>('button[value="ok"]')!.focus();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

let textDialog: HTMLDialogElement | null = null;

/**
 * Asks for a line of text in the app's own dialog (the browser's prompt stood apart from the app):
 * the text, or null when cancelled. Enter takes it (the form's first button is 취소).
 */
export function askText(action: string, label: string, value = ''): Promise<string | null> {
  if (!textDialog) {
    textDialog = document.createElement('dialog');
    textDialog.id = 'text-dialog';
    textDialog.setAttribute('aria-labelledby', 'text-title');
    textDialog.innerHTML = '<form method="dialog"><h2 class="ask-title" id="text-title"></h2><label><span class="text-label"></span><input name="text" autocomplete="off" /></label><menu><button value="cancel">취소</button><button value="ok" class="primary"></button></menu></form>';
    document.body.append(textDialog);
  }
  const d = textDialog;
  d.querySelector('.ask-title')!.textContent = action;
  d.querySelector('.text-label')!.textContent = label;
  d.querySelector('button[value="ok"]')!.textContent = action;
  const input = d.querySelector<HTMLInputElement>('input')!;
  input.value = value;
  input.onkeydown = (e) => {
    if (e.key !== 'Enter' || e.isComposing) return; // (not the Enter that ends a Hangul syllable)
    e.preventDefault();
    d.close('ok');
  };
  d.returnValue = '';
  d.showModal();
  input.focus();
  input.select();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok' ? input.value : null), { once: true }));
}

// A file picker drawn as a button (a label round a hidden input) opens with Enter or Space too.
// (Only in a page: the tests load this module without one.)
if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => {
  const el = (e.target as HTMLElement).closest?.<HTMLElement>('[data-file-key]');
  if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  el.querySelector<HTMLInputElement>('input[type=file]')?.click();
});

/**
 * Months the landfill lasts, by the month's own rubbish after burning (the first month after a landfill
 * opens takes the whole backlog, so not by what was buried): 0 once full, endless (≥ 100 years) while
 * everything is burnt or recycled, null with no landfill.
 */
export function landfillMonths(g: { kept?: number; produced: number; recycled: number; incinerated: number; landfilled: number; landfillSpace: number }): number | null {
  const monthly = Math.max(0, (g.kept || g.produced - g.recycled) - g.incinerated);
  if (g.landfillSpace <= 0) return g.landfilled > 0 ? 0 : null;
  return monthly > 0 ? Math.floor(g.landfillSpace / monthly) : Infinity;
}

export const landfillSpan = (months: number) => (months >= 1200 ? '100년 넘게' : months >= 24 ? `${Math.floor(months / 12)}년` : `${months}개월`);

/** A message's first sentence: a toast says what happened; the screen it opens says the rest. */
export const firstSentence = (t: string) => /^.*?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;

/**
 * Korean line breaks the browser leaves loose, held with word joiners (unseen, unread): a closing parenthesis with
 * the particle after it ("상한(21,560명)에" put "에 닿았습니다" at the start of a line), an opening one with the
 * word before it, and the halves of a 가·나 pair ("병원·" ended a line, "보건소가" began the next).
 */
export const glue = (t: string) => t.replace(/\)(?=[가-힣])/g, ')\u2060').replace(/([가-힣\d%])(?=\()/g, '$1\u2060').replace(/([가-힣])·(?=[가-힣])/g, '$1\u2060·\u2060');

/** Said when the clock was stopped for something (a toast's tail). */
export const stoppedNote = () => ` · 멈춤 (${touchFirst() ? '▶로 계속' : 'Space로 계속'})`;

/** A path tile by tile as its straight runs, end to end (a line or road tool lays one run at a time). */
export function straightRuns(path: readonly [number, number][]): [number, number, number, number][] {
  const runs: [number, number, number, number][] = [];
  let from = path[0]!;
  for (let k = 2; k < path.length; k++) {
    const [a, b, c] = [path[k - 2]!, path[k - 1]!, path[k]!];
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) {
      runs.push([from[0], from[1], b[0], b[1]]);
      from = b;
    }
  }
  if (path.length) runs.push([from[0], from[1], path.at(-1)![0], path.at(-1)![1]]);
  return runs;
}
