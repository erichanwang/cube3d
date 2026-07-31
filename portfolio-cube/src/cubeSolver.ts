import type { CubeMove, MoveFace } from './types';
import { F2L_TABLE, ZBLS_TABLE } from './cubeTables.ts';
import { lookupZBLLCase } from './zbllHashmap.ts';
import type { ZBLLCase } from './zbllTable.ts';

/**
 * A real CFOP solver: cross, F2L, ZBLS, ZBLL.
 *
 * REPRESENTATION — cubie, not facelet.
 * Every stage of CFOP is stated in terms of pieces ("is the front-right pair
 * solved", "are the last-layer edges oriented"), never in terms of individual
 * stickers. A cubie model answers those questions with an array lookup, and it
 * makes the case keys below a direct read of four small numbers instead of a
 * scan over 54 stickers. State is four arrays indexed BY POSITION:
 *   cp[p] = which corner piece sits at corner position p, co[p] = its twist
 *   ep[p] = which edge piece sits at edge position p,   eo[p] = its flip
 *
 * GEOMETRY — the move tables are derived, not typed.
 * MOVE_DEFS and rotate() mirror RubiksChapter.tsx exactly (note y = +1 is DOWN
 * there, because the DOM y axis points down the screen). Deriving the
 * permutations from that geometry rather than transcribing Singmaster tables is
 * what guarantees this solver and the animation agree on which way R turns;
 * scripts/verify-solver.mjs proves it against the component's own cubelet model.
 *
 * Cross colour is white, and white is the D face, so the cross is built on the
 * bottom and the last layer is U.
 */

type Vec = readonly [number, number, number];

const FACES = ['R', 'L', 'U', 'D', 'F', 'B'] as const;
export type Face = typeof FACES[number];

/** Mirrors MOVE_DEFS in RubiksChapter.tsx. */
const MOVE_DEFS: Record<Face, { axis: 0 | 1 | 2; layer: (v: Vec) => boolean; sign: number }> = {
  R: { axis: 0, layer: (v) => v[0] === 1, sign: -1 },
  L: { axis: 0, layer: (v) => v[0] === -1, sign: 1 },
  U: { axis: 1, layer: (v) => v[1] === -1, sign: 1 },
  D: { axis: 1, layer: (v) => v[1] === 1, sign: -1 },
  F: { axis: 2, layer: (v) => v[2] === 1, sign: 1 },
  B: { axis: 2, layer: (v) => v[2] === -1, sign: -1 },
};

/** Mirrors rotateGrid() in RubiksChapter.tsx. */
function rotate(axis: number, sign: number, v: Vec): Vec {
  const [x, y, z] = v;
  if (axis === 0) return [x, -sign * z, sign * y];
  if (axis === 1) return [sign * z, y, -sign * x];
  return [-sign * y, sign * x, z];
}

function buildCoords() {
  const corners: Vec[] = [];
  const edges: Vec[] = [];
  for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) corners.push([x, y, z]);
  for (let x = -1; x <= 1; x += 1)
    for (let y = -1; y <= 1; y += 1)
      for (let z = -1; z <= 1; z += 1)
        if ([x, y, z].filter((c) => c === 0).length === 1) edges.push([x, y, z]);
  return { corners, edges };
}

export const CORNER_COORDS = buildCoords().corners;
export const EDGE_COORDS = buildCoords().edges;

const keyOf = (v: Vec) => `${v[0]},${v[1]},${v[2]}`;
const CORNER_INDEX = new Map(CORNER_COORDS.map((v, i) => [keyOf(v), i]));
const EDGE_INDEX = new Map(EDGE_COORDS.map((v, i) => [keyOf(v), i]));

/** 12 quarter turns: index = face * 2 + (prime ? 1 : 0). */
export const MOVES: CubeMove[] = FACES.flatMap((face) => [{ face }, { face, prime: true }]);
export const MOVE_NAMES = MOVES.map((m) => `${m.face}${m.prime ? "'" : ''}`);

/**
 * Corner twist is stored as the axis its D/U sticker currently points along
 * (0 = that axis is y, so the corner is oriented; 1 = x; 2 = z). Any bijection
 * on the three twists would do; this one makes "oriented" mean co === 0 without
 * needing modular twist arithmetic.
 */
const TWIST_AXIS = [1, 0, 2];
const AXIS_TWIST = [1, 0, 2];

const cornerPerm: Uint8Array[] = [];
const cornerTwist: Uint8Array[] = [];
const edgePerm: Uint8Array[] = [];
const edgeFlip: Uint8Array[] = [];

for (let m = 0; m < MOVES.length; m += 1) {
  const move = MOVES[m]!;    const def = MOVE_DEFS[move.face as Face];
  const sign = def.sign * (move.prime ? -1 : 1);
  const cPerm = new Uint8Array(8);
  const cTwist = new Uint8Array(8 * 3);
  const ePerm = new Uint8Array(12);
  const eFlip = new Uint8Array(12);
  CORNER_COORDS.forEach((v, p) => {
    const moved = def.layer(v);
    cPerm[p] = moved ? CORNER_INDEX.get(keyOf(rotate(def.axis, sign, v)))! : p;
    for (let c = 0; c < 3; c += 1) {
      if (!moved) { cTwist[p * 3 + c] = c; continue; }
      const unit: Vec = [TWIST_AXIS[c] === 0 ? 1 : 0, TWIST_AXIS[c] === 1 ? 1 : 0, TWIST_AXIS[c] === 2 ? 1 : 0];
      const spun = rotate(def.axis, sign, unit);
      cTwist[p * 3 + c] = AXIS_TWIST[spun.findIndex((n) => n !== 0)]!;
    }
  });
  EDGE_COORDS.forEach((v, p) => {
    const moved = def.layer(v);
    ePerm[p] = moved ? EDGE_INDEX.get(keyOf(rotate(def.axis, sign, v)))! : p;
    // Standard edge orientation about the U/D axis: only F and B quarter turns
    // flip, so eo === 0 in a U/D slot means the U/D sticker faces up or down.
    eFlip[p] = moved && (move.face === 'F' || move.face === 'B') ? 1 : 0;
  });
  cornerPerm.push(cPerm);
  cornerTwist.push(cTwist);
  edgePerm.push(ePerm);
  edgeFlip.push(eFlip);
}

export interface DerivedMoveTable {
  cornerPerm: Uint8Array;
  cornerTwist: Uint8Array;
  edgePerm: Uint8Array;
  edgeFlip: Uint8Array;
}

/** Derive a slice table from the same coordinate geometry as outer turns. */
function deriveSliceTable(
  axis: 0 | 1 | 2,
  layer: (v: Vec) => boolean,
  sign: number,
  flips: boolean,
): DerivedMoveTable {
  const cPerm = new Uint8Array(8);
  const cTwist = new Uint8Array(8 * 3);
  const ePerm = new Uint8Array(12);
  const eFlip = new Uint8Array(12);
  CORNER_COORDS.forEach((v, p) => {
    const moved = layer(v);
    cPerm[p] = moved ? CORNER_INDEX.get(keyOf(rotate(axis, sign, v)))! : p;
    for (let c = 0; c < 3; c += 1) {
      if (!moved) { cTwist[p * 3 + c] = c; continue; }
      const unit: Vec = [TWIST_AXIS[c] === 0 ? 1 : 0, TWIST_AXIS[c] === 1 ? 1 : 0, TWIST_AXIS[c] === 2 ? 1 : 0];
      const spun = rotate(axis, sign, unit);
      cTwist[p * 3 + c] = AXIS_TWIST[spun.findIndex((n) => n !== 0)]!;
    }
  });
  EDGE_COORDS.forEach((v, p) => {
    const moved = layer(v);
    ePerm[p] = moved ? EDGE_INDEX.get(keyOf(rotate(axis, sign, v)))! : p;
    eFlip[p] = moved && flips ? 1 : 0;
  });
  return { cornerPerm: cPerm, cornerTwist: cTwist, edgePerm: ePerm, edgeFlip: eFlip };
}

const SLICE_TABLES: Record<'M' | 'E' | 'S', DerivedMoveTable> = {
  // Singmaster M follows L, E follows D, and S follows F.
  M: deriveSliceTable(0, (v) => v[0] === 0, 1, true),
  E: deriveSliceTable(1, (v) => v[1] === 0, -1, false),
  S: deriveSliceTable(2, (v) => v[2] === 0, 1, true),
};

function composeTables(first: DerivedMoveTable, second: DerivedMoveTable): DerivedMoveTable {
  const cornerPerm = new Uint8Array(8);
  const cornerTwist = new Uint8Array(24);
  const edgePerm = new Uint8Array(12);
  const edgeFlip = new Uint8Array(12);
  for (let p = 0; p < 8; p += 1) {
    const middle = first.cornerPerm[p]!;
    cornerPerm[p] = second.cornerPerm[middle]!;
    for (let o = 0; o < 3; o += 1) {
      cornerTwist[p * 3 + o] = second.cornerTwist[middle * 3 + first.cornerTwist[p * 3 + o]!]!;
    }
  }
  for (let p = 0; p < 12; p += 1) {
    const middle = first.edgePerm[p]!;
    edgePerm[p] = second.edgePerm[middle]!;
    edgeFlip[p] = first.edgeFlip[p]! ^ second.edgeFlip[middle]!;
  }
  return { cornerPerm, cornerTwist, edgePerm, edgeFlip };
}

const OUTER_TABLES: Record<Face, DerivedMoveTable> = Object.fromEntries(
  FACES.map((face, i) => [face, {
    cornerPerm: cornerPerm[i * 2]!,
    cornerTwist: cornerTwist[i * 2]!,
    edgePerm: edgePerm[i * 2]!,
    edgeFlip: edgeFlip[i * 2]!,
  }]),
) as Record<Face, DerivedMoveTable>;

function inverseTable(table: DerivedMoveTable): DerivedMoveTable {
  return composeTables(table, composeTables(table, table));
}

const EXTENDED_BASE_TABLES: Record<MoveFace, DerivedMoveTable> = {
  ...OUTER_TABLES,
  M: SLICE_TABLES.M,
  E: SLICE_TABLES.E,
  S: SLICE_TABLES.S,
  r: composeTables(OUTER_TABLES.R, inverseTable(SLICE_TABLES.M)),
  l: composeTables(OUTER_TABLES.L, SLICE_TABLES.M),
  u: composeTables(OUTER_TABLES.U, inverseTable(SLICE_TABLES.E)),
  d: composeTables(OUTER_TABLES.D, SLICE_TABLES.E),
  f: composeTables(OUTER_TABLES.F, SLICE_TABLES.S),
  b: composeTables(OUTER_TABLES.B, inverseTable(SLICE_TABLES.S)),
  x: composeTables(composeTables(OUTER_TABLES.R, inverseTable(SLICE_TABLES.M)), inverseTable(OUTER_TABLES.L)),
  y: composeTables(composeTables(OUTER_TABLES.U, inverseTable(SLICE_TABLES.E)), inverseTable(OUTER_TABLES.D)),
  z: composeTables(composeTables(OUTER_TABLES.F, SLICE_TABLES.S), inverseTable(OUTER_TABLES.B)),
};

/** Exposed so scripts can search the same geometry with slice/wide moves. */
export const EXTENDED_MOVES: CubeMove[] = [
  ...MOVES,
  ...(['M', 'E', 'S', 'r', 'l', 'u', 'd', 'f', 'b', 'x', 'y', 'z'] as const).flatMap((face) => [{ face }, { face, prime: true }]),
];
export const EXTENDED_MOVE_TABLES: DerivedMoveTable[] = EXTENDED_MOVES.map((move) => {
  const base = EXTENDED_BASE_TABLES[move.face];
  return move.prime ? inverseTable(base) : base;
});

/** Exposed so scripts/gen-cube-tables.mjs searches with the same geometry. */
export const MOVE_TABLES = { cornerPerm, cornerTwist, edgePerm, edgeFlip };

export interface CubeState {
  cp: Uint8Array;
  co: Uint8Array;
  ep: Uint8Array;
  eo: Uint8Array;
}

export function solvedState(): CubeState {
  return {
    cp: Uint8Array.from({ length: 8 }, (_, i) => i),
    co: new Uint8Array(8),
    ep: Uint8Array.from({ length: 12 }, (_, i) => i),
    eo: new Uint8Array(12),
  };
}

export function cloneState(s: CubeState): CubeState {
  return { cp: s.cp.slice(), co: s.co.slice(), ep: s.ep.slice(), eo: s.eo.slice() };
}

function applyTable(s: CubeState, table: DerivedMoveTable): CubeState {
  const out: CubeState = { cp: new Uint8Array(8), co: new Uint8Array(8), ep: new Uint8Array(12), eo: new Uint8Array(12) };
  for (let p = 0; p < 8; p += 1) {
    const q = table.cornerPerm[p]!;
    out.cp[q] = s.cp[p]!;
    out.co[q] = table.cornerTwist[p * 3 + s.co[p]!]!;
  }
  for (let p = 0; p < 12; p += 1) {
    const q = table.edgePerm[p]!;
    out.ep[q] = s.ep[p]!;
    out.eo[q] = s.eo[p]! ^ table.edgeFlip[p]!;
  }
  return out;
}

export function applyMoveIndex(s: CubeState, m: number): CubeState {
  return applyTable(s, {
    cornerPerm: cornerPerm[m]!,
    cornerTwist: cornerTwist[m]!,
    edgePerm: edgePerm[m]!,
    edgeFlip: edgeFlip[m]!,
  });
}

function applyTableTurns(state: CubeState, table: DerivedMoveTable, turns: number): CubeState {
  let out = state;
  for (let i = 0; i < turns; i += 1) out = applyTable(out, table);
  return out;
}

export function moveIndex(move: CubeMove): number {
  const index = FACES.indexOf(move.face as Face);
  if (index < 0) throw new Error(`moveIndex only accepts outer turns: ${move.face}`);
  return index * 2 + (move.prime ? 1 : 0);
}

function applyExtendedMove(state: CubeState, move: CubeMove): CubeState {
  const prime = Boolean(move.prime);
  const turns = move.turns ?? 1;
  const quarterTurns = turns % 4;
  if (quarterTurns === 0) return state;
  if (FACES.includes(move.face as Face)) {
    const quarter = { face: move.face as Face, prime: prime && turns !== 2 };
    let out = state;
    for (let i = 0; i < quarterTurns; i += 1) out = applyMoveIndex(out, moveIndex(quarter));
    return out;
  }
  const base = EXTENDED_BASE_TABLES[move.face];
  const table = prime ? inverseTable(base) : base;
  return applyTableTurns(state, table, quarterTurns);
}

export function applyMoves(state: CubeState, moves: CubeMove[]): CubeState {
  let out = state;
  for (const move of moves) out = applyExtendedMove(out, move);
  return out;
}

export function isSolved(s: CubeState): boolean {
  for (let i = 0; i < 8; i += 1) if (s.cp[i] !== i || s.co[i] !== 0) return false;
  for (let i = 0; i < 12; i += 1) if (s.ep[i] !== i || s.eo[i] !== 0) return false;
  return true;
}

// ── geometry-derived piece groups ───────────────────────────────────────
/** y = +1 is the bottom layer in the component's coordinates: the cross layer. */
export const CROSS_EDGES = EDGE_COORDS.map((v, i) => (v[1] === 1 ? i : -1)).filter((i) => i >= 0);
export const LL_EDGES = EDGE_COORDS.map((v, i) => (v[1] === -1 ? i : -1)).filter((i) => i >= 0);
export const LL_CORNERS = CORNER_COORDS.map((v, i) => (v[1] === -1 ? i : -1)).filter((i) => i >= 0);
/** The four F2L slots, each a bottom corner plus the middle edge beside it. */
export const SLOTS = CORNER_COORDS.map((v, corner) => {
  if (v[1] !== 1) return null;
  const edge = EDGE_INDEX.get(keyOf([v[0], 0, v[2]]))!;
  return { corner, edge };
}).filter((s): s is { corner: number; edge: number } => s !== null);

export const crossSolved = (s: CubeState) => CROSS_EDGES.every((i) => s.ep[i] === i && s.eo[i] === 0);
export const slotSolved = (s: CubeState, slot: number) => {
  const { corner, edge } = SLOTS[slot]!;
  return s.cp[corner] === corner && s.co[corner] === 0 && s.ep[edge] === edge && s.eo[edge] === 0;
};
export const f2lSolved = (s: CubeState) => crossSolved(s) && SLOTS.every((_, i) => slotSolved(s, i));
export const edgesOriented = (s: CubeState) => s.eo.every((o) => o === 0);
/** The entire U face is yellow when every last-layer corner and edge is oriented. */
export const yellowSideSolved = (s: CubeState) =>
  LL_CORNERS.every((p) => s.co[p] === 0) && LL_EDGES.every((p) => s.eo[p] === 0);

// ── case keys ───────────────────────────────────────────────────────────
/**
 * KEY ENCODING. Every stage keys on the smallest set of pieces whose state its
 * algorithm depends on, packed as fixed-width digits so the key is a plain
 * string and the lookup is one Map.get:
 *
 *   corner digit = position * 3 + twist   (0..23)
 *   edge digit   = position * 2 + flip    (0..23)
 *
 *   F2L   `${slot}:${cornerDigit}.${edgeDigit}`   — where that slot's pair is
 *   ZBLS  `${cornerDigit}.${edgeDigit}.${eoMask}` — last pair, plus the flip of
 *         the five free edges (four LL positions + the empty slot) as a bitmask
 *   ZBLL  `${yellowPattern}|${corners}|${edges}` — the whole last layer at once;
 *         the yellow pattern is the four LL corner-orientation digits *         the legacy two-look keys (if regenerated) are those two halves on
 *         their own; the runtime uses the complete canonical ZBLL key above

 *
 * F2L and ZBLS are generated by search in scripts/gen-cube-tables.mjs. The
 * complete canonical ZBLL table is generated separately from verified ZBLL
 * cases in zbllTable.ts.
 */
const cornerDigit = (s: CubeState, piece: number) => {
  const p = s.cp.indexOf(piece);
  return p * 3 + s.co[p]!;
};
const edgeDigit = (s: CubeState, piece: number) => {
  const p = s.ep.indexOf(piece);
  return p * 2 + s.eo[p]!;
};

export const f2lKey = (s: CubeState, slot: number) =>
  `${slot}:${cornerDigit(s, SLOTS[slot]!.corner)}.${edgeDigit(s, SLOTS[slot]!.edge)}`;

export function zblsKey(s: CubeState, slot: number): string {
  const { corner, edge } = SLOTS[slot]!;
  let mask = 0;
  LL_EDGES.forEach((p, i) => { mask |= s.eo[p]! << i; });
  mask |= s.eo[edge]! << 4;
  return `${cornerDigit(s, corner)}.${edgeDigit(s, edge)}.${mask}`;
}

export const llTwistKey = (s: CubeState) => LL_CORNERS.map((p) => s.co[p]).join(',');
export const llCornersKey = (s: CubeState) => LL_CORNERS.map((p) => s.cp[p]).join(',');
export const llEdgesKey = (s: CubeState) => LL_EDGES.map((p) => s.ep[p]).join(',');
export const zbllKey = (s: CubeState) => `${llTwistKey(s)}|${llCornersKey(s)}|${llEdgesKey(s)}`;

// ── move strings ────────────────────────────────────────────────────────
export function parseAlg(alg: string): CubeMove[] {
  if (!alg) return [];
  return alg.split(/\s+/).filter(Boolean).map((token) => {
    const base = token.replace(/2$/, '').replace(/'$/, '');
    const rawFace = base.endsWith('w') ? base[0]!.toLowerCase() : base;
    const face = rawFace as MoveFace;
    if (!['R', 'L', 'U', 'D', 'F', 'B', 'M', 'E', 'S', 'r', 'l', 'u', 'd', 'f', 'b', 'x', 'y', 'z'].includes(face)) {
      throw new Error(`Unsupported algorithm move: ${token}`);
    }
    return {
      face,
      prime: token.endsWith("'") || undefined,
      turns: token.endsWith('2') ? 2 : undefined,
    };
  });
}

/** Collapse adjacent turns, including U U -> U2 and five U turns -> U'. */
export function compressMoves(moves: CubeMove[]): CubeMove[] {
  const result: CubeMove[] = [];
  for (const move of moves) {
    const amount = (move.turns ?? 1) * (move.prime ? -1 : 1);
    const previous = result[result.length - 1];
    if (!previous || previous.face !== move.face) {
      const normalized = ((amount % 4) + 4) % 4;
      if (normalized === 0) continue;
      result.push({ face: move.face, ...(normalized === 2 ? { turns: 2 as const } : normalized === 3 ? { prime: true } : {}) });
      continue;
    }
    const previousAmount = (previous.turns ?? 1) * (previous.prime ? -1 : 1);
    const normalized = ((previousAmount + amount) % 4 + 4) % 4;
    result.pop();
    if (normalized === 0) continue;
    result.push({ face: move.face, ...(normalized === 2 ? { turns: 2 as const } : normalized === 3 ? { prime: true } : {}) });
  }
  return result;
}

export const formatAlg = (moves: CubeMove[]) => compressMoves(moves).map((m) => `${m.face}${m.turns === 2 ? '2' : m.prime ? "'" : ''}`).join(' ');

// ── cross ───────────────────────────────────────────────────────────────
/**
 * The cross is the one stage with no case list: 190,080 distinct arrangements
 * of four edges is too many to ship as algorithms, and too few to need search.
 * A breadth-first sweep from the solved cross fills an exact
 * distance-to-solved table over the coordinate below, built once on the first
 * solve (about 330k bytes, a few tens of milliseconds). Solving is then a walk
 * downhill: at every step pick any turn whose distance is one lower. That is a
 * table lookup per move, never a search, and the cross it finds is optimal.
 *
 * Coordinate: the four cross edges as four base-24 digits (position * 2 + flip).
 */
const CROSS_SIZE = 24 ** 4;
let crossTable: Uint8Array | null = null;

function crossCoord(s: CubeState): number {
  let index = 0;
  for (let i = CROSS_EDGES.length - 1; i >= 0; i -= 1) {
    const piece = CROSS_EDGES[i]!;
    const p = s.ep.indexOf(piece);
    index = index * 24 + p * 2 + s.eo[p]!;
  }
  return index;
}

/** The same coordinate advanced by one turn, without touching a full state. */
function crossCoordMove(coord: number, m: number): number {
  const ePerm = edgePerm[m]!;
  const eFlip = edgeFlip[m]!;
  let out = 0;
  for (let i = 3; i >= 0; i -= 1) {
    const digit = Math.floor(coord / 24 ** i) % 24;
    const p = digit >> 1;
    out = out * 24 + ePerm[p]! * 2 + ((digit & 1) ^ eFlip[p]!);
  }
  return out;
}

function buildCrossTable(): Uint8Array {
  const table = new Uint8Array(CROSS_SIZE).fill(255);
  const start = crossCoord(solvedState());
  table[start] = 0;
  let frontier = [start];
  for (let depth = 0; frontier.length; depth += 1) {
    const next: number[] = [];
    for (const coord of frontier) {
      for (let m = 0; m < 12; m += 1) {
        const to = crossCoordMove(coord, m);
        if (table[to] !== 255) continue;
        table[to] = depth + 1;
        next.push(to);
      }
    }
    frontier = next;
  }
  return table;
}

function solveCross(state: CubeState): { moves: CubeMove[]; state: CubeState } {
  crossTable ??= buildCrossTable();
  const moves: CubeMove[] = [];
  let s = state;
  let coord = crossCoord(s);
  let distance = crossTable[coord]!;
  while (distance > 0) {
    for (let m = 0; m < 12; m += 1) {
      const to = crossCoordMove(coord, m);
      if (crossTable[to] !== distance - 1) continue;
      moves.push(MOVES[m]!);
      s = applyMoveIndex(s, m);
      coord = to;
      distance -= 1;
      break;
    }
  }
  return { moves, state: s };
}

// ── F2L ─────────────────────────────────────────────────────────────────
/**
 * Every F2L algorithm in the table assumes its pair is in the last layer or
 * already in its own slot, and every one of them preserves the cross and the
 * other three slots. When a pair piece is trapped in a different slot it has to
 * come out first, which is what these three-turn ejections do. Their direction
 * is picked by simulation rather than asserted, so it cannot disagree with the
 * geometry above.
 */
export const EJECTS: CubeMove[][] = SLOTS.map(({ corner, edge }) => {
  const candidates: CubeMove[][] = [];
  const v = CORNER_COORDS[corner]!;
  const sides: Face[] = [v[0] === 1 ? 'R' : 'L', v[2] === 1 ? 'F' : 'B'];
  for (const face of sides) {
    for (const prime of [false, true]) {
      candidates.push([{ face, prime }, { face: 'U' }, { face, prime: !prime }]);
    }
  }
  return candidates.find((alg) => {
    const after = applyMoves(solvedState(), alg);
    const cornerUp = CORNER_COORDS[after.cp.indexOf(corner)]![1] === -1;
    const edgeUp = EDGE_COORDS[after.ep.indexOf(edge)]![1] === -1;
    const rest = SLOTS.every((s, i) => s.corner === corner || slotSolved(after, i));
    return cornerUp && edgeUp && crossSolved(after) && rest;
  })!;
});

/** A pair piece is stuck if it sits in a slot other than its own. */
export function trappedSlot(s: CubeState, slot: number): number {
  const { corner, edge } = SLOTS[slot]!;
  const cornerAt = s.cp.indexOf(corner);
  const edgeAt = s.ep.indexOf(edge);
  for (let i = 0; i < SLOTS.length; i += 1) {
    if (i === slot) continue;
    if (SLOTS[i]!.corner === cornerAt || SLOTS[i]!.edge === edgeAt) return i;
  }
  return -1;
}

function lookup(table: Record<string, string>, key: string, stage: string): CubeMove[] {
  const alg = table[key];
  if (alg === undefined) throw new Error(`${stage}: no case for ${key}`);
  return parseAlg(alg);
}

function runStage(state: CubeState, moves: CubeMove[], alg: CubeMove[]) {
  const normalized = compressMoves(alg);
  moves.push(...normalized);
  return applyMoves(state, normalized);
}

// ── the solve ───────────────────────────────────────────────────────────
export type StageName = 'Cross' | 'F2L' | 'ZBLS' | 'ZBLL';
export interface SolveStage {
  stage: StageName;
  moves: CubeMove[];
  /** The F2L slot this stage is inserting, used only by the visualizer. */
  slot?: number;
  caseLabel?: ZBLLCase['label'];
  /** Friendly method name when ZBLS already orients the complete yellow face. */
  descriptor?: 'Winter Variation' | 'PLL';
}

export function solveStages(start: CubeState): SolveStage[] {
  const stages: SolveStage[] = [];
  const cross = solveCross(start);
  stages.push({ stage: 'Cross', moves: cross.moves });
  let s = cross.state;

  // three slots by lookup, the fourth handed to ZBLS
  const order = [0, 1, 2, 3];
  for (const slot of order.slice(0, 3)) {
    const moves: CubeMove[] = [];
    for (let guard = 0; guard < 8 && trappedSlot(s, slot) >= 0; guard += 1) {
      s = runStage(s, moves, EJECTS[trappedSlot(s, slot)]!);
    }
    s = runStage(s, moves, lookup(F2L_TABLE, f2lKey(s, slot), 'F2L'));
    stages.push({ stage: 'F2L', moves, slot });
  }

  const zbls: CubeMove[] = [];
  const zblsCase = zblsKey(s, order[3]!);
  s = runStage(s, zbls, lookup(ZBLS_TABLE, zblsCase, 'ZBLS'));
  const yellowSolvedAfterZbls = yellowSideSolved(s);
  stages.push({
    stage: 'ZBLS',
    moves: zbls,
    slot: order[3],
    descriptor: yellowSolvedAfterZbls ? 'Winter Variation' : undefined,
  });

  const zbll: CubeMove[] = [];
  let zbllCase: ZBLLCase | undefined;
  // The generated table stores one representative for each U-equivalence
  // class. Apply the matching AUF first, then execute exactly one ZBLL case.
  for (let auf = 0; auf < 4; auf += 1) {
    const oriented = applyMoves(s, Array.from({ length: auf }, () => ({ face: 'U' })));
    const candidate = lookupZBLLCase(zblsCase, llTwistKey(oriented), zbllKey(oriented));
    if (!candidate) continue;
    s = runStage(s, zbll, Array.from({ length: auf }, () => ({ face: 'U' })));
    s = runStage(s, zbll, parseAlg(candidate.alg));
    if (!isSolved(s)) throw new Error(`ZBLL: bad algorithm for ${zbllKey(oriented)}`);
    zbllCase = candidate;
    break;
  }
  if (!zbllCase) throw new Error(`ZBLL: no canonical case for ${zbllKey(s)}`);
  stages.push({ stage: 'ZBLL', moves: zbll, caseLabel: zbllCase.label, descriptor: yellowSolvedAfterZbls ? 'PLL' : undefined });

  if (!isSolved(s)) throw new Error('solver finished on an unsolved cube');
  return stages;
}

export function solve(state: CubeState): CubeMove[] {
  return solveStages(state).flatMap((stage) => stage.moves);
}
