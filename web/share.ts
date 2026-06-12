// Encode a board into a compact, URL-safe string (for location.hash) and decode
// it back with validation, so a position can be shared by link.  Pure (no DOM),
// and defensive: a shared string is sanitized -- arrays clamped, energy /
// conditions filtered to the known sets, points clamped.  Unknown CARD names are
// left as-is here and handled safely downstream (the app validates names via
// hasCard / findAnyCard before use, and renders all text through el()).

export interface ShareSlot { name: string; id?: string; energy: string[]; damage: number; conditions: string[]; }
export interface ShareBoard {
  mine: (ShareSlot | null)[];
  opp: (ShareSlot | null)[];
  hand: string[];
  pending: string;
  myPts: number;
  oppPts: number;
  oppZone: string[];
}

const ENERGIES = new Set(['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal']);
const CONDITIONS = new Set(['asleep', 'paralyzed', 'poisoned', 'burned', 'confused']);

export function encodeBoard(board: ShareBoard): string {
  return btoa(JSON.stringify(board)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strList(v: unknown, allowed?: Set<string>, max = 99): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && (!allowed || allowed.has(x))).slice(0, max);
}

function slot(s: unknown): ShareSlot | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (typeof o.name !== 'string') return null;
  return {
    name: o.name,
    ...(typeof o.id === 'string' ? { id: o.id } : {}),
    energy: strList(o.energy, ENERGIES, 4),
    damage: Math.max(0, Number(o.damage) || 0),
    conditions: strList(o.conditions, CONDITIONS, 5),
  };
}

function fourSlots(v: unknown): (ShareSlot | null)[] {
  const arr = Array.isArray(v) ? v.slice(0, 4).map(slot) : [];
  while (arr.length < 4) arr.push(null);
  return arr;
}

const clampPts = (v: unknown): number => Math.max(0, Math.min(3, Number(v) || 0));

export function decodeBoard(str: string): ShareBoard | null {
  if (!str) return null;
  try {
    const json = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;
    return {
      mine: fourSlots(raw.mine),
      opp: fourSlots(raw.opp),
      hand: strList(raw.hand, undefined, 20),
      pending: typeof raw.pending === 'string' && ENERGIES.has(raw.pending) ? raw.pending : '',
      myPts: clampPts(raw.myPts),
      oppPts: clampPts(raw.oppPts),
      oppZone: strList(raw.oppZone, ENERGIES, 3),
    };
  } catch {
    return null;
  }
}
