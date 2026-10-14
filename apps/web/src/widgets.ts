// Touch-style sliders: the part of the track up to the thumb is filled (CSS --fill).
// Sliders are created all over the panels, so new ones are picked up as they appear.

/** Sets a slider's filled share from its value. */
export function fillRange(r: HTMLInputElement): void {
  const min = Number(r.min || 0);
  const max = Number(r.max || 100);
  r.style.setProperty('--fill', `${(((Number(r.value) - min) / (max - min || 1)) * 100).toFixed(1)}%`);
  // A tick at a value that matters (a budget's 100%): sliders with different ends put it in different places.
  if (r.dataset.mark) {
    const m = ((Number(r.dataset.mark) - min) / (max - min || 1)) * 100;
    // The thumb's centre travels 11px short of either end of the track.
    r.style.setProperty('--mark', `calc(11px + (100% - 22px) * ${(m / 100).toFixed(4)})`);
  }
}

export function setupRangeFill(): void {
  const isRange = (n: unknown): n is HTMLInputElement => n instanceof HTMLInputElement && n.type === 'range';
  // Touch: a slider moves only when its thumb is taken. A sheet scrolled with
  // a finger that happens to start on a track (a tax rate, a budget) or a
  // stray tap would otherwise set the value where the finger landed.
  const held = new Map<HTMLInputElement, string>();
  document.addEventListener('pointerdown', (e) => {
    const r = e.target;
    if (!isRange(r) || e.pointerType !== 'touch') return;
    const box = r.getBoundingClientRect();
    const min = Number(r.min || 0);
    const max = Number(r.max || 100);
    const thumb = box.left + 11 + (box.width - 22) * ((Number(r.value) - min) / (max - min || 1));
    if (Math.abs(e.clientX - thumb) > 24) held.set(r, r.value);
  }, true);
  const release = (e: Event) => {
    const r = e.target;
    if (!isRange(r) || !held.has(r)) return;
    r.value = held.get(r)!;
    held.delete(r);
    fillRange(r);
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  // While held, the slider's own handlers never hear of the change.
  for (const type of ['input', 'change']) {
    document.addEventListener(type, (e) => {
      const r = e.target;
      if (!isRange(r) || !held.has(r)) return;
      e.stopImmediatePropagation();
      r.value = held.get(r)!;
    }, true);
  }
  document.addEventListener('input', (e) => {
    if (isRange(e.target)) fillRange(e.target);
  }, true);
  const scan = (root: ParentNode) => root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(fillRange);
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (isRange(n)) fillRange(n);
        else if (n instanceof HTMLElement && n.firstElementChild) scan(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan(document);
}

/**
 * Bar, dock and tray buttons let go of focus after a tap or click, so the
 * keyboard shortcuts that follow don't draw a focus ring on them (keyboard
 * presses of a button keep it, for keyboard users).
 */
export function setupPointerBlur(): void {
  document.addEventListener('click', (e) => {
    if (e.detail === 0) return; // a key press, not a pointer
    const b = (e.target as Element).closest?.('#mapbar :is(button, summary), #pane .crumbs button, #dock-col :is(button, summary), #tray button, #map-controls button, #tool-chip button');
    if (b instanceof HTMLElement) b.blur();
  });
}

/**
 * Phones: a card that rises from the bottom closes when its top strip (the
 * grip, its header) is dragged down, the way such sheets do; it follows the
 * finger until let go.
 */
export function setupSwipeDown(el: HTMLElement, close: () => void): void {
  let start: { id: number; y: number } | null = null;
  let dy = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !matchMedia('(max-width: 860px)').matches) return;
    if (e.clientY - el.getBoundingClientRect().top > 56) return;
    if ((e.target as HTMLElement).closest('button, input, select, a')) return;
    start = { id: e.pointerId, y: e.clientY };
    dy = 0;
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    dy = Math.max(0, e.clientY - start.y);
    el.style.transform = dy ? `translateY(${dy}px)` : '';
  });
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    el.style.transform = '';
    if (dy > 70) close();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/**
 * Touch screens show no tooltips: tapping a chip, a fact's label, a gauge or
 * a KPI that carries one (title=) shows it in the hint bar instead.
 */
export function setupTouchTitles(show: (text: string) => void): void {
  document.addEventListener('click', (e) => {
    if (!matchMedia('(pointer: coarse) and (hover: none)').matches) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('#info .chip[title], #info td[title], #info h3[title], .kpi[title], .hero[title], .tax-effect[title], .info-meter[title], .budget-table tr[title]');
    if (!el || el.closest('button, a, input, select') || !el.title) return;
    show(el.title);
  });
}
