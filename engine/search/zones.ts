import type { Environment, OccluderShape, SearchZone } from '@/types';
import { pointInPolygon, shapePolygon } from '@/engine/navigation/occluders';

/**
 * Search zones: places of the card where the player can look for gems. The author draws them and gives each a weight; the game hides the
 * gems in secret (the weights are the odds), so the scenario never says where a gem really is.
 */
export const SEARCH_COLORS = ['#4fd1c5', '#f5b84a', '#b57bff', '#ff6b6b', '#4f8cff', '#3ecf8e', '#f472b6', '#facc15'];
export const MAX_WEIGHT = 10;
export const DEFAULT_WEIGHT = 2;

export function newSearchZone(existing: SearchZone[], id: string, shape: OccluderShape): SearchZone {
  const used = new Set(existing.map((z) => z.name));
  let n = existing.length + 1; while (used.has(`Zona ${n}`)) n++;
  return { id, name: `Zona ${n}`, weight: DEFAULT_WEIGHT, color: SEARCH_COLORS[existing.length % SEARCH_COLORS.length], shape: { ...shape, mode: 'add' } };
}

/** Outline of a zone as normalized x, y pairs (ellipses and splines are sampled). */
export const zonePolygon = (z: Pick<SearchZone, 'shape'>): number[] => shapePolygon(z.shape);

export interface ZoneInfo { zone: SearchZone; polygon: number[]; /** share of the hidden gems, 0–1 */ share: number }
export function searchZoneInfo(env: Pick<Environment, 'searchZones'>): ZoneInfo[] {
  const zs = env.searchZones ?? [], total = zs.reduce((a, z) => a + Math.max(0, z.weight), 0);
  return zs.map((zone) => ({ zone, polygon: zonePolygon(zone), share: total > 0 ? Math.max(0, zone.weight) / total : 0 }));
}

/** Pairs of zones that overlap: scratching on the overlap would be ambiguous. Checked on a coarse grid of points of one zone inside the other. */
export function overlappingZones(env: Pick<Environment, 'searchZones'>): [SearchZone, SearchZone][] {
  const info = searchZoneInfo(env), out: [SearchZone, SearchZone][] = [];
  const bbox = (p: number[]) => { let x0 = 1, y0 = 1, x1 = 0, y1 = 0; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } return { x0, y0, x1, y1 }; };
  for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
    const a = bbox(info[i].polygon), b = bbox(info[j].polygon);
    const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1), y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
    if (x1 <= x0 || y1 <= y0) continue;
    let hit = 0, n = 0;
    for (let gx = 0; gx < 14; gx++) for (let gy = 0; gy < 14; gy++) {
      const x = x0 + ((gx + 0.5) / 14) * (x1 - x0), y = y0 + ((gy + 0.5) / 14) * (y1 - y0);
      n++; if (pointInPolygon(info[i].polygon, x, y) && pointInPolygon(info[j].polygon, x, y)) hit++;
    }
    if (hit / n > 0.04) out.push([info[i].zone, info[j].zone]);
  }
  return out;
}

export interface ZoneIssue { level: 'error' | 'warn'; text: string }
/** Checks of the search zones for the "ready for the game" list. Zones are optional: a scenario without them is simply not playable by search. */
export function searchZoneIssues(env: Pick<Environment, 'searchZones'>): ZoneIssue[] {
  const zs = env.searchZones ?? [], out: ZoneIssue[] = [];
  if (!zs.length) return [{ level: 'warn', text: 'Nessuna zona di ricerca: nel gioco a zone il giocatore non avrebbe dove cercare le gemme (strumento «Zone di ricerca», R).' }];
  if (zs.length < 3) out.push({ level: 'warn', text: 'Poche zone di ricerca: con meno di tre il giocatore non ha una vera scelta.' });
  const total = zs.reduce((a, z) => a + Math.max(0, z.weight), 0);
  if (total <= 0) out.push({ level: 'error', text: 'Tutte le zone di ricerca hanno peso 0: le gemme non avrebbero dove nascondersi.' });
  else if (zs.filter((z) => z.weight > 0).length < 2) out.push({ level: 'warn', text: 'Una sola zona può contenere gemme: il giocatore la troverebbe subito.' });
  if (zs.every((z) => z.weight > 0) && zs.length >= 3) out.push({ level: 'warn', text: 'Nessuna zona a peso 0: senza zone sempre vuote cercare non è mai un errore.' });
  const names = new Set<string>(); for (const z of zs) { if (names.has(z.name)) out.push({ level: 'warn', text: `Due zone si chiamano «${z.name}».` }); names.add(z.name); }
  for (const [a, b] of overlappingZones(env)) out.push({ level: 'warn', text: `Le zone «${a.name}» e «${b.name}» si sovrappongono: dove si toccano non è chiaro quale venga scelta.` });
  return out;
}

/** What goes into scenario.json: id, name, weight and the outline (normalized to the image). The hidden gems are never decided here. */
export function searchZonesExport(env: Pick<Environment, 'searchZones'>) {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return (env.searchZones ?? []).map((z) => ({ id: z.id, name: z.name, weight: z.weight, color: z.color, polygon: zonePolygon(z).map(r) }));
}
