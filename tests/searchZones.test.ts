import { describe, expect, it } from 'vitest';
import { newSearchZone, overlappingZones, searchZoneInfo, searchZoneIssues, searchZonesExport } from '@/engine/search/zones';
import type { OccluderShape, SearchZone } from '@/types';

const rect = (x0: number, y0: number, x1: number, y1: number): OccluderShape => ({ kind: 'shape', mode: 'add', shape: 'rect', pts: [x0, y0, x1, y1] });
let n = 0;
const zone = (id: string, shape: OccluderShape, weight = 2): SearchZone => ({ ...newSearchZone([], id, shape), name: `Z${++n}`, weight });

describe('search zones', () => {
  it('names and colours new zones in sequence', () => {
    const a = newSearchZone([], 'a', rect(0, 0, 0.1, 0.1));
    const b = newSearchZone([a], 'b', rect(0.2, 0.2, 0.3, 0.3));
    expect(a.name).toBe('Zona 1'); expect(b.name).toBe('Zona 2'); expect(a.color).not.toBe(b.color);
  });
  it('the share of each zone follows its weight; weight 0 is always empty', () => {
    const zs = [zone('a', rect(0, 0, 0.1, 0.1), 3), zone('b', rect(0.2, 0, 0.3, 0.1), 1), zone('c', rect(0.5, 0, 0.6, 0.1), 0)];
    const info = searchZoneInfo({ searchZones: zs });
    expect(info.map((i) => i.share)).toEqual([0.75, 0.25, 0]);
  });
  it('detects overlapping zones but not disjoint ones', () => {
    expect(overlappingZones({ searchZones: [zone('a', rect(0, 0, 0.3, 0.3)), zone('b', rect(0.2, 0.2, 0.5, 0.5))] })).toHaveLength(1);
    expect(overlappingZones({ searchZones: [zone('a', rect(0, 0, 0.2, 0.2)), zone('b', rect(0.5, 0.5, 0.7, 0.7))] })).toHaveLength(0);
  });
  it('warns when there are no zones, too few, all weights 0, or overlaps', () => {
    expect(searchZoneIssues({}).some((i) => i.level === 'warn')).toBe(true);
    expect(searchZoneIssues({ searchZones: [zone('a', rect(0, 0, 0.1, 0.1), 0)] }).some((i) => i.level === 'error')).toBe(true);
    const ok = [zone('a', rect(0, 0, 0.1, 0.1)), zone('b', rect(0.2, 0, 0.3, 0.1)), zone('c', rect(0.4, 0, 0.5, 0.1), 0)];
    expect(searchZoneIssues({ searchZones: ok })).toEqual([]);
  });
  it('exports normalized polygons without any gem placement', () => {
    const out = searchZonesExport({ searchZones: [zone('a', rect(0.1, 0.2, 0.3, 0.4), 5)] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', weight: 5 });
    expect(out[0].polygon.length).toBeGreaterThanOrEqual(8);
    expect(out[0].polygon.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Object.keys(out[0])).not.toContain('gem');
  });
});
