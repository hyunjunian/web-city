// What the data views mean, apart from drawing them: per-tile readings for the
// hover hint, the growth view's colours and labels, abandonment risk, and how
// far a facility reaches (coverage circles).

import { DEFAULT_CONFIG, GROWTH_CODES, isRail, Net, NETWORK_KINDS, serviceRadius, STRUCTURES, Terrain, type City } from '@web-city/engine';
import { ABANDON_NAME, TYPE_NAME } from './names';
import { fmt, hours } from './util';
import type { Overlay, VolumeNetwork } from './render';

/** The growth view: one colour and label per main blocker of an empty zone, plus abandoned buildings. */
export const ABANDONED_COLOR = '#c0392b';
export const RISK_COLOR = 'rgba(243,156,18,0.75)';

/** What a building is counting down to abandonment for, in words ('' if nothing). */
export function buildingRisk(b: { noPowerMonths: number; noWaterMonths: number; noRoadMonths: number; noJobMonths: number; distressMonths: number }, understaffed = false): string {
  return [b.noPowerMonths && `전기 ${b.noPowerMonths}개월`, b.noWaterMonths && `물 ${b.noWaterMonths}개월`, b.noRoadMonths && `도로 ${b.noRoadMonths}개월`,
    b.noJobMonths && `일자리 못 구함 ${b.noJobMonths}개월`, b.distressMonths && `${understaffed ? '일할 사람 부족' : '쾌적도 낮음'} ${b.distressMonths}개월`].filter(Boolean).join(' · ');
}
export const GROWTH_COLOR: Record<(typeof GROWTH_CODES)[number], string> = {
  unbuildable: '#6b5240', tooSteep: '#6b5240', rubble: '#3a3530', noPower: '#e8c21a', noRoad: '#8a8f99', noJobs: '#a05cd6',
  // No demand and a demand cap need opposite fixes, and neither may look like a commercial zone (blue).
  noDemand: '#c2569b', lowDesirability: '#e2782a', waiting: '#3fb85f', noWater: '#4fc3f7', capped: '#0f9d8f', noWorkers: '#7a6bd6',
};
export const GROWTH_LABEL: Record<(typeof GROWTH_CODES)[number], string> = {
  unbuildable: '지을 수 없음', tooSteep: '너무 가파름', rubble: '잔해 (철거하세요)', noPower: '전기 없음', noRoad: '도로 없음', noJobs: '갈 일자리 없음',
  noDemand: '수요 없음', lowDesirability: '쾌적도 부족', waiting: '개발 대기', noWater: '물 없음', capped: '수요 상한', noWorkers: '일손 부족',
};

/** The overlay's value on one tile, in words (for the hover hint); '' where it shows nothing. */
export function overlayReading(city: City, overlay: Overlay, x: number, y: number): string {
  const s = city.state;
  if (x < 0 || y < 0 || x >= s.size || y >= s.size) return ''; // off the map (or a row over)
  const f = city.fields;
  const i = y * s.size + x;
  const r = (v: number) => Math.round(v);
  const resident = () => {
    const occ = s.occupant[i]!;
    const b = occ > 0 ? s.buildings.get(occ) : undefined;
    return b?.type?.[0] === 'R' ? b : undefined;
  };
  switch (overlay.kind) {
    case 'none': return '';
    case 'desirability': return `${TYPE_NAME[overlay.type]} 쾌적도 ${r(city.desirabilityMap(overlay.type)[i]!)}`;
    case 'landValue': return `땅값 ${r(f.landValue[i]!)}`;
    case 'air': return `대기 오염 ${r(f.air[i]!)}`;
    case 'police': return `경찰 보호 ${r(f.policeCover[i]!)}${s.crime[i]! >= 0.05 ? ` · 범죄 ${s.crime[i]!.toFixed(1)}` : ''}`;
    case 'fire': return `소방 보호 ${r(f.fireCover[i]!)}${f.flammability[i] ? ` · 화재 위험 ${r(f.flammability[i]!)}` : ''}`;
    case 'mayor': return f.mayorSet[i] ? `시장 평점 ${r(f.mayor[i]!)}` : '';
    case 'garbage': return s.zone[i] === 10 ? `매립 ${r(s.landfill[i]!)} / 300 t` : `쌓인 쓰레기 ${r(s.garbage[i]!)} t`;
    case 'waterPollution': return `수질 오염 ${r(f.waterPollution[i]!)}`;
    case 'waterService': return s.pipe[i] ? `수도관 · 노후 ${s.pipeWear[i]}${s.pipeWear[i]! >= 50 ? ' (터질 수 있음)' : ''}` : f.watered[i] ? '급수 범위' : f.waterNet[i]! >= 0 ? '관은 있지만 공급 없음' : '물 없음';
    case 'power': return `${f.powered[i] ? '전력망에 연결됨' : '전기 없음'}${s.power[i] ? ` · 송전선 노후 ${s.lineWear[i]}${s.lineWear[i]! >= 50 ? ' (불꽃이 튈 수 있음)' : ''}` : ''}`;
    // (The home's own index beside the reach: as the view's own names say them, not HQ and EQ.)
    case 'health': { const b = resident(); return `병원 효과 ${r(f.healthQuality[i]! * 100)}%${b ? ` · 건강 지수 ${r(b.hq)}` : ''}`; }
    case 'school': { const b = resident(); return `학교 효과 ${r(f.schoolQuality[i]! * 100)}%${b ? ` · 교육 지수 ${r(b.eq)}` : ''}`; }
    case 'commute': {
      const b = resident() ?? (() => {
        const occ = s.occupant[i]!;
        const x = occ > 0 ? s.buildings.get(occ) : undefined;
        return x?.type?.[0] === 'I' ? x : undefined;
      })();
      if (!b) return '';
      const what = b.type![0] === 'R' ? '통근' : '화물';
      return b.commute < 0 || b.commute > DEFAULT_CONFIG.transport.tripLimit ? `${what}: 2.5시간 안에 닿는 곳 없음` : `${what} ${hours(b.commute)}`;
    }
    case 'age': { const b = resident(); return b ? `평균 나이 ${r(b.age)}세` : ''; }
    case 'zones': return '';
    case 'growth': {
      const occ = s.occupant[i]!;
      const b = occ > 0 ? s.buildings.get(occ) : undefined;
      if (b && !b.type) return `버려진 건물${b.abandonReason ? ` (${ABANDON_NAME[b.abandonReason]})` : ''}`;
      if (b) {
        const risk = buildingRisk(b, !!b.distressMonths && city.understaffed(b.id));
        return risk ? `버려질 위험: ${risk}` : '';
      }
      const code = occ ? 0 : growthNow(city)?.[i] ?? 0;
      return code ? GROWTH_LABEL[GROWTH_CODES[code - 1]!] : '';
    }
    case 'radiation': return s.radiation[i] ? `방사능 ${r(s.radiation[i]!)}` : '방사능 없음';
    case 'traffic': {
      const code = s.net[i]!;
      const speed = DEFAULT_CONFIG.transport.speed;
      // Each way here as its band draws it: how many go over it a day (its width) and how near its capacity (its colour).
      const way = (name: string, v: number, cap: number) => `${name}통행 ${fmt(r(v))} · 혼잡 ${r((v / cap) * 100)}%`;
      const up = s.elevated[i]!;
      const over = up ? way(`${['', '고가 철도', '모노레일', '고가 고속도로'][up]} `, (up === 1 ? f.subwayTraffic : up === 2 ? f.monorailTraffic : f.highTraffic)[i]!,
        up === 1 ? speed.elrail.capacity : up === 2 ? speed.monorail.capacity : speed.highway.capacity) : '';
      const ferry = s.terrain[i] === Terrain.Water && f.ferryTraffic[i]! > 0 ? way('페리 ', f.ferryTraffic[i]!, speed.ferry.capacity) : '';
      // (Off the networks, a home's commute or a works' freight, as the view colours them.)
      if (code === Net.None) return [ferry, over].filter(Boolean).join(' · ') || overlayReading(city, { ...overlay, kind: 'commute' } as Overlay, x, y);
      if (s.railDamage[i]) return '망가진 철로 (대중교통 예산 100% 넘으면 고쳐짐)';
      const ground = code === Net.Rail ? way('', f.railTraffic[i]!, speed.rail.capacity) : way('', f.traffic[i]!, speed[NETWORK_KINDS[code]!].capacity);
      return [ground, over].filter(Boolean).join(' · ');
    }
    case 'volume': {
      const v = volumeAt(s, f, overlay.network, i);
      return v >= 0 ? `${overlay.network === 'evening' ? '저녁 통행량' : '통행량'} ${fmt(v)}` : '';
    }
    case 'subway': return s.subway[i] ? `지하철 승객 ${r(f.subwayTraffic[i]!)}` : '';
  }
}

/** The last whole growth map, kept to draw from while a day is part-way through. */
let growthSeen: { city: object; map: Uint8Array } | null = null;

/**
 * The growth view's map: worked out between days (the engine keeps it until
 * the fields change), the last one while a day is under way — asking then
 * finished the day inside the frame (half a second on a big map).
 */
export function growthNow(city: City): Uint8Array | null {
  if (city.stepping) return growthSeen?.city === city ? growthSeen.map : null;
  const map = city.growthMap();
  growthSeen = { city, map };
  return map;
}

/** Trips over tile i on one network (−1 where that network isn't). */
export function volumeAt(s: City['state'], f: City['fields'], network: VolumeNetwork, i: number): number {
  switch (network) {
    case 'road': return s.net[i] && !isRail(s.net[i]!) ? f.traffic[i]! : -1;
    case 'evening': return s.net[i] && !isRail(s.net[i]!) ? f.eveningTraffic[i]! : -1;
    case 'rail': return isRail(s.net[i]!) ? f.railTraffic[i]! : -1;
    case 'subway': return s.subway[i] || s.elevated[i] === 1 ? f.subwayTraffic[i]! : -1;
    case 'monorail': return s.elevated[i] === 2 ? f.monorailTraffic[i]! : -1;
    case 'highway': return s.elevated[i] === 3 ? f.highTraffic[i]! : -1;
    case 'ferry': return s.terrain[i] === Terrain.Water && f.ferryTraffic[i]! > 0 ? f.ferryTraffic[i]! : -1;
  }
}

/** How far a facility's service reaches, in tiles (0: none, or the whole city). */
export function coverageRadius(kind: keyof typeof STRUCTURES, st?: Parameters<typeof serviceRadius>[2]): number {
  const def = STRUCTURES[kind];
  const r = def.police?.radius ?? def.fire?.radius
    ?? (def.health || def.school ? (st ? serviceRadius(DEFAULT_CONFIG, def, st) : (def.health ?? def.school)!.radius) : 0);
  return r && r < 200 ? r : 0;
}
