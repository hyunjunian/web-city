// Minimap: the whole city at one pixel per tile, with the view outlined; click or drag on it to move.

import { Net, Terrain } from '@web-city/engine';
import { TYPE_COLOR } from './render';
import { type Band, cam, city, mapBand, redraw, renderer } from './state';

const canvas = document.querySelector<HTMLCanvasElement>('#minimap');
const ctx = canvas?.getContext('2d');
/** The minimap's CSS width, 0 while hidden: kept by an observer (reading it each frame forced a layout after every panel update). */
let shown = 0;
if (canvas && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(([e]) => {
    shown = e!.contentRect.width;
    if (shown && city) drawMinimap(true);
  }).observe(canvas);
}
let base: HTMLCanvasElement | null = null;
let baseAt = -Infinity;
let baseCity: unknown = null;
let trailing: number | null = null;

const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const BUILDING: Record<string, [number, number, number]> = Object.fromEntries(
  Object.entries(TYPE_COLOR).map(([k, v]) => [k, rgb(v)]),
);
// Zone tints by zone code (light R, medium R, high R, C ×3, I ×2, farm, landfill).
const ZONE: ([number, number, number] | null)[] = [
  null, [176, 214, 150], [160, 206, 140], [140, 196, 130], [170, 196, 226], [150, 182, 222], [130, 166, 214],
  [226, 206, 150], [222, 190, 130], [214, 200, 150], [150, 130, 90],
];

/** Repaints the tile image (at most twice a second unless forced). */
function paintBase(force: boolean): void {
  const s = city.state;
  const n = s.size;
  const now = performance.now();
  // A big map's repaint is costly: less often (the view box still moves every frame).
  const every = n > 160 ? 2000 : 500;
  if (!force && base && baseCity === city && now - baseAt < every) {
    // Catch up shortly so a paused city still shows the latest edit.
    trailing ??= window.setTimeout(() => {
      trailing = null;
      drawMinimap(true);
    }, every - (now - baseAt));
    return;
  }
  baseAt = now;
  baseCity = city;
  if (!base || base.width !== n) {
    base = document.createElement('canvas');
    base.width = n;
    base.height = n;
  }
  const bctx = base.getContext('2d')!;
  const img = bctx.createImageData(n, n);
  const d = img.data;
  for (let i = 0; i < n * n; i++) {
    let c: [number, number, number];
    const occ = s.occupant[i]!;
    if (s.terrain[i] === Terrain.Water && !s.net[i]) c = [93, 143, 199];
    else if (s.net[i] && s.net[i] !== Net.None) c = [86, 87, 92];
    else if (occ > 0) {
      const b = s.buildings.get(occ);
      c = b?.type ? BUILDING[b.type]! : [91, 85, 80];
    } else if (occ < 0) c = [120, 120, 130];
    else {
      const z = ZONE[s.zone[i]!];
      if (z) c = z;
      else {
        const t = Math.min(1, s.height[i]! / 120);
        c = [207 - 40 * t, 216 - 30 * t, 184 - 50 * t];
      }
    }
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
}

/** The whole city as a small PNG data URL (for the save list). */
export function thumbnail(): string {
  paintBase(true);
  try {
    return base!.toDataURL('image/png');
  } catch {
    return '';
  }
}

/** Draws the minimap; `force` repaints the tiles now (after an edit or a new city). */
export function drawMinimap(force = false): void {
  if (!canvas || !ctx || !shown) return;
  paintBase(force);
  const n = city.size;
  const size = shown;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }
  const k = canvas.width / n;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base!, 0, 0, canvas.width, canvas.height);
  // The part of the city on screen: what the floating pane and bars leave of it.
  const b = visible();
  const x = Math.round((cam.x + b.left / cam.scale) * k);
  const y = Math.round((cam.y + b.top / cam.scale) * k);
  const w = Math.max(4, Math.round(((b.right - b.left) / cam.scale) * k));
  const h = Math.max(4, Math.round(((b.bottom - b.top) / cam.scale) * k));

  // Kept within the map (a view wider than it drew stray lines across), and none at all while the whole map
  // is in view; the rest of the map dims around it, so the part on screen stands out.
  const W = canvas.width;
  const H = canvas.height;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  const slack = W * 0.03; // (a view a pixel or two short of the whole map is the whole map)
  if (x0 > slack || y0 > slack || x1 < W - slack || y1 < H - slack) {
    ctx.fillStyle = 'rgba(10,14,24,0.32)';
    ctx.fillRect(0, 0, W, y0);
    ctx.fillRect(0, y1, W, H - y1);
    ctx.fillRect(0, y0, x0, y1 - y0);
    ctx.fillRect(x1, y0, W - x1, y1 - y0);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#1d6fd1';
    ctx.strokeRect(x0 + dpr, y0 + dpr, Math.max(2, x1 - x0 - 2 * dpr), Math.max(2, y1 - y0 - 2 * dpr));
  }
  // What can't wait — a building alight (red), a riot (orange) — a dot each, from anywhere on the map.
  const st = city.state;
  const dot = (x: number, y: number, fill: string): void => {
    ctx.beginPath();
    ctx.arc(x * k, y * k, 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; // (reads on orange industry too)
    ctx.stroke();
  };
  for (const f of st.fires) {
    const r = f.target > 0 ? st.buildings.get(f.target) : st.structures.get(-f.target);
    if (r) dot(r.x + r.w / 2, r.y + r.h / 2, '#ff4d2e');
  }
  for (const mob of st.mobs) dot(mob.x + 0.5, mob.y + 0.5, '#ff9a1f');
  // An open goal's marks: its troubled facilities as dots, the suggested spot as a ring (found from anywhere).
  for (const m of renderer.marks) {
    if (m.tone === '' || m.tone === 'area') continue; // (an area's outline: its target ring stands for it)
    const mx = (m.x + m.w / 2) * k;
    const my = (m.y + m.h / 2) * k;
    ctx.beginPath();
    if (m.tone === 'spot') {
      ctx.arc(mx, my, 5 * dpr, 0, Math.PI * 2);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#2f6fe0';
      ctx.stroke();
    } else {
      ctx.arc(mx, my, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = m.tone === 'bad' ? '#ff4d4f' : '#f5a524';
      ctx.fill();
    }
  }
}

/** The part of the map nothing floats over (mapBand), measured now and then: it reads the layout, and the view box
 *  is drawn every frame. */
let band: Band | null = null;
let bandAt = 0;
function visible(): Band {
  const now = performance.now();
  if (!band || now - bandAt > 400) {
    band = mapBand();
    bandAt = now;
  }
  return band;
}

export function setupMinimap(): void {
  if (!canvas) return;
  // The spot pressed comes to the middle of the map that shows (beside the city pane, between the bars).
  const move = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const tx = ((e.clientX - r.left) / r.width) * city.size;
    const ty = ((e.clientY - r.top) / r.height) * city.size;
    const b = visible();
    cam.x = tx - (b.left + b.right) / 2 / cam.scale;
    cam.y = ty - (b.top + b.bottom) / 2 / cam.scale;
    redraw();
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    move(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) move(e);
  });
}
