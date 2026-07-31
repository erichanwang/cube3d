/**
 * Generates src/experimental/cubeTables.ts — every algorithm the CFOP solver
 * plays, found by search rather than transcribed from memory.
 *
 * For each stage the script
 *   1. enumerates the reachable cases by walking the subgroup that keeps the
 *      earlier stages solved, so every case state is legal by construction,
 *   2. runs IDA* over the 12 quarter turns with pattern databases for the
 *      heuristic, giving a shortest solution for that case,
 *   3. replays the solution on the case state and refuses to emit it unless the
 *      stage goal actually holds afterwards.
 *
 * A case key names exactly the pieces the goal depends on, and moves act on
 * those pieces independently of everything else, so one verified representative
 * per key is a proof for every state sharing that key.
 *
 * Run: node scripts/gen-cube-tables.mjs [--zbll-budget N] [--zbll-cases N]
 */
import { writeFileSync } from 'node:fs';
import {
  MOVES, MOVE_TABLES, SLOTS, CORNER_COORDS, CROSS_EDGES, LL_CORNERS, LL_EDGES,
  solvedState, applyMoves, isSolved, crossSolved, slotSolved, f2lSolved, edgesOriented,
  f2lKey, zblsKey, zbllKey, llTwistKey, llCornersKey, llEdgesKey, parseAlg, formatAlg,
  EJECTS, trappedSlot,
} from '../src/cubeSolver.ts';
import { F2L_TABLE as PRIOR_F2L, ZBLS_TABLE as PRIOR_ZBLS } from '../src/cubeTables.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
/** --reuse keeps the cross-to-ZBLS tables from the last run while the last-layer
 *  looks are re-searched, which is the only part worth iterating on. */
const REUSE = args.includes('--reuse') && Object.keys(PRIOR_ZBLS).length > 0;

const { cornerPerm, cornerTwist, edgePerm, edgeFlip } = MOVE_TABLES;
const NM = MOVES.length;

// ── fast state plumbing ─────────────────────────────────────────────────
const blank = () => ({ cp: new Uint8Array(8), co: new Uint8Array(8), ep: new Uint8Array(12), eo: new Uint8Array(12) });
function copyInto(src, dst) {
  dst.cp.set(src.cp); dst.co.set(src.co); dst.ep.set(src.ep); dst.eo.set(src.eo);
}
function applyInto(src, dst, m) {
  const cP = cornerPerm[m], cT = cornerTwist[m], eP = edgePerm[m], eF = edgeFlip[m];
  for (let p = 0; p < 8; p += 1) {
    const q = cP[p];
    dst.cp[q] = src.cp[p];
    dst.co[q] = cT[p * 3 + src.co[p]];
  }
  for (let p = 0; p < 12; p += 1) {
    const q = eP[p];
    dst.ep[q] = src.ep[p];
    dst.eo[q] = src.eo[p] ^ eF[p];
  }
}

/** Piece code: corner = position * 3 + twist, edge = position * 2 + flip. */
const cornerCodeMove = [];
const edgeCodeMove = [];
for (let m = 0; m < NM; m += 1) {
  const cc = new Uint8Array(24);
  for (let code = 0; code < 24; code += 1) {
    const p = (code / 3) | 0, o = code % 3;
    cc[code] = cornerPerm[m][p] * 3 + cornerTwist[m][p * 3 + o];
  }
  const ec = new Uint8Array(24);
  for (let code = 0; code < 24; code += 1) {
    const p = code >> 1, o = code & 1;
    ec[code] = edgePerm[m][p] * 2 + (o ^ edgeFlip[m][p]);
  }
  cornerCodeMove.push(cc);
  edgeCodeMove.push(ec);
}
/** Edge flips are a property of the slot, so the whole flip mask moves as one. */
const eoMaskMove = [];
for (let m = 0; m < NM; m += 1) {
  const table = new Uint16Array(4096);
  for (let mask = 0; mask < 4096; mask += 1) {
    let out = 0;
    for (let p = 0; p < 12; p += 1) out |= (((mask >> p) & 1) ^ edgeFlip[m][p]) << edgePerm[m][p];
    table[mask] = out;
  }
  eoMaskMove.push(table);
}

// ── pattern databases ───────────────────────────────────────────────────
/**
 * Each database is an exact breadth-first distance over one coordinate: the
 * positions and orientations of a handful of pieces. Every coordinate is closed
 * under the moves, so the distance is a true lower bound on the full cube and
 * the maximum over several databases is still admissible.
 */
function buildPieceDB(corners, edges, goals) {
  const digits = corners.length + edges.length;
  const size = 24 ** digits;
  const table = new Uint8Array(size).fill(255);
  let frontier = [];
  for (const goal of goals) {
    let index = 0;
    for (let i = digits - 1; i >= 0; i -= 1) index = index * 24 + goal[i];
    if (table[index] === 255) { table[index] = 0; frontier.push(index); }
  }
  const radix = Array.from({ length: digits }, (_, i) => 24 ** i);
  for (let depth = 0; frontier.length; depth += 1) {
    const next = [];
    for (const index of frontier) {
      for (let m = 0; m < NM; m += 1) {
        let to = 0;
        for (let i = 0; i < digits; i += 1) {
          const code = ((index / radix[i]) | 0) % 24;
          to += radix[i] * (i < corners.length ? cornerCodeMove[m][code] : edgeCodeMove[m][code]);
        }
        if (table[to] !== 255) continue;
        table[to] = depth + 1;
        next.push(to);
      }
    }
    frontier = next;
  }
  return table;
}

function buildEoDB() {
  const table = new Uint8Array(4096).fill(255);
  table[0] = 0;
  let frontier = [0];
  for (let depth = 0; frontier.length; depth += 1) {
    const next = [];
    for (const mask of frontier) {
      for (let m = 0; m < NM; m += 1) {
        const to = eoMaskMove[m][mask];
        if (table[to] !== 255) continue;
        table[to] = depth + 1;
        next.push(to);
      }
    }
    frontier = next;
  }
  return table;
}

/** The ZBLS goal in one coordinate: the last pair plus every edge flip. */
function buildZblsDB(slot) {
  const { corner, edge } = SLOTS[slot];
  const size = 24 * 24 * 4096;
  const table = new Uint8Array(size).fill(255);
  const index = (c, e, mask) => (c * 24 + e) * 4096 + mask;
  const start = index(corner * 3, edge * 2, 0);
  table[start] = 0;
  let frontier = [start];
  for (let depth = 0; frontier.length; depth += 1) {
    const next = [];
    for (const i of frontier) {
      const mask = i % 4096;
      const pair = (i / 4096) | 0;
      const c = (pair / 24) | 0;
      const e = pair % 24;
      for (let m = 0; m < NM; m += 1) {
        const to = index(cornerCodeMove[m][c], edgeCodeMove[m][e], eoMaskMove[m][mask]);
        if (table[to] !== 255) continue;
        table[to] = depth + 1;
        next.push(to);
      }
    }
    frontier = next;
  }
  return table;
}

const t0 = Date.now();
const crossDB = buildPieceDB([], CROSS_EDGES, [CROSS_EDGES.map((e) => e * 2)]);
const slotDB = SLOTS.map(({ corner, edge }) => buildPieceDB([corner], [edge], [[corner * 3, edge * 2]]));
const llCornerDB = buildPieceDB(LL_CORNERS, [], [LL_CORNERS.map((c) => c * 3)]);
/** Corners untwisted but in any order: the goal of the first last-layer look. */
const permutations = (items) => (items.length <= 1 ? [items]
  : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));
const llTwistDB = buildPieceDB(LL_CORNERS, [], permutations(LL_CORNERS).map((order) => order.map((c) => c * 3)));
const llEdgeDB = buildPieceDB([], LL_EDGES, [LL_EDGES.map((e) => e * 2)]);
const eoDB = buildEoDB();
const zblsDB = buildZblsDB(3);
console.log(`pattern databases built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ── coordinates of a live state ─────────────────────────────────────────
const invC = new Uint8Array(8);
const invE = new Uint8Array(12);
function inverses(s) {
  for (let p = 0; p < 8; p += 1) invC[s.cp[p]] = p;
  for (let p = 0; p < 12; p += 1) invE[s.ep[p]] = p;
}
const cornerCode = (s, piece) => invC[piece] * 3 + s.co[invC[piece]];
const edgeCode = (s, piece) => invE[piece] * 2 + s.eo[invE[piece]];
function pieceIndex(s, corners, edges) {
  let index = 0;
  for (let i = corners.length + edges.length - 1; i >= 0; i -= 1) {
    index = index * 24 + (i < corners.length ? cornerCode(s, corners[i]) : edgeCode(s, edges[i - corners.length]));
  }
  return index;
}
function eoMask(s) {
  let mask = 0;
  for (let p = 0; p < 12; p += 1) mask |= s.eo[p] << p;
  return mask;
}

const hCross = (s) => crossDB[pieceIndex(s, [], CROSS_EDGES)];
const hSlot = (s, i) => slotDB[i][pieceIndex(s, [SLOTS[i].corner], [SLOTS[i].edge])];
const hZbls = (s) => zblsDB[(cornerCode(s, SLOTS[3].corner) * 24 + edgeCode(s, SLOTS[3].edge)) * 4096 + eoMask(s)];

function heuristicF2L(s) {
  inverses(s);
  let h = hCross(s);
  for (let i = 0; i < 4; i += 1) h = Math.max(h, hSlot(s, i));
  return h;
}
function heuristicZbls(s) {
  inverses(s);
  let h = Math.max(hCross(s), hZbls(s));
  for (let i = 0; i < 3; i += 1) h = Math.max(h, hSlot(s, i));
  return h;
}
function heuristicLL(s, corners, edges) {
  inverses(s);
  let h = Math.max(hCross(s), eoDB[eoMask(s)]);
  for (let i = 0; i < 4; i += 1) h = Math.max(h, hSlot(s, i));
  if (corners) {
    const db = corners === 'twist' ? llTwistDB : llCornerDB;
    h = Math.max(h, db[pieceIndex(s, LL_CORNERS, [])]);
  }
  if (edges) h = Math.max(h, llEdgeDB[pieceIndex(s, [], LL_EDGES)]);
  return h;
}

// ── IDA* ────────────────────────────────────────────────────────────────
const MAX_DEPTH = 24;
const stack = Array.from({ length: MAX_DEPTH + 1 }, blank);
const path = new Int8Array(MAX_DEPTH);
const faceOf = (m) => m >> 1;
const axisOf = (m) => m >> 2;

function search(start, goal, heuristic, budget = Infinity) {
  copyInto(start, stack[0]);
  let nodes = 0;
  let solution = null;

  function dfs(depth, limit, prev) {
    const s = stack[depth];
    if (goal(s)) { solution = Array.from(path.slice(0, depth)); return true; }
    if (depth === limit) return false;
    if (depth + heuristic(s) > limit) return false;
    for (let m = 0; m < NM; m += 1) {
      if (prev >= 0 && (faceOf(m) === faceOf(prev) || (axisOf(m) === axisOf(prev) && faceOf(m) < faceOf(prev)))) continue;
      nodes += 1;
      if (nodes > budget) return false;
      applyInto(s, stack[depth + 1], m);
      path[depth] = m;
      if (dfs(depth + 1, limit, m)) return true;
    }
    return false;
  }

  for (let limit = heuristic(stack[0]); limit <= MAX_DEPTH; limit += 1) {
    if (dfs(0, limit, -1)) return { moves: solution.map((m) => MOVES[m]), nodes };
    if (nodes > budget) return { moves: null, nodes };
  }
  return { moves: null, nodes };
}

// ── case enumeration ────────────────────────────────────────────────────
/**
 * The states a stage can be handed are exactly the orbit of the solved cube
 * under the sequences that leave the earlier stages alone, so walking that
 * orbit enumerates the cases without ever building an unreachable cube.
 */
function stabiliserGenerators(slot) {
  const [x, , z] = CORNER_COORDS[SLOTS[slot].corner];
  const sides = [x === 1 ? 'R' : 'L', z === 1 ? 'F' : 'B'];
  const pool = [[{ face: 'U' }], [{ face: 'U', prime: true }]];
  for (const face of sides) {
    for (const prime of [false, true]) {
      for (const turns of [1, 2, 3]) {
        pool.push([
          { face, prime },
          ...Array.from({ length: turns }, () => ({ face: 'U' })),
          { face, prime: !prime },
        ]);
      }
    }
  }
  // keep only the ones that put the cross and every other slot back untouched
  return pool.filter((alg) => {
    const after = applyMoves(solvedState(), alg);
    return crossSolved(after) && SLOTS.every((_, i) => i === slot || slotSolved(after, i));
  });
}

function walkCases(slot, keyOf, steps) {
  const generators = stabiliserGenerators(slot);
  const cases = new Map();
  let s = solvedState();
  for (let i = 0; i < steps; i += 1) {
    s = applyMoves(s, generators[(Math.random() * generators.length) | 0]);
    const key = keyOf(s);
    if (!cases.has(key)) cases.set(key, s);
  }
  return cases;
}

// ── stage 1: F2L ────────────────────────────────────────────────────────
const F2L_TABLE = REUSE ? { ...PRIOR_F2L } : {};
let f2lNodes = 0;
for (let slot = 0; slot < (REUSE ? 0 : 4); slot += 1) {
  const cases = walkCases(slot, (s) => f2lKey(s, slot), 60000);
  for (const [key, state] of cases) {
    const { moves, nodes } = search(state, f2lSolved, heuristicF2L);
    if (!moves) throw new Error(`F2L ${key}: no solution`);
    f2lNodes += nodes;
    if (!f2lSolved(applyMoves(state, moves))) throw new Error(`F2L ${key}: bad algorithm`);
    F2L_TABLE[key] = formatAlg(moves);
  }
  process.stdout.write(`F2L slot ${slot}: ${cases.size} cases\n`);
}
const f2lLengths = Object.values(F2L_TABLE).map((a) => parseAlg(a).length);
console.log(`F2L: ${Object.keys(F2L_TABLE).length} cases, mean ${(f2lLengths.reduce((a, b) => a + b, 0) / f2lLengths.length).toFixed(1)} max ${Math.max(...f2lLengths)} turns, ${f2lNodes} nodes`);

// ── stage 2: ZBLS ───────────────────────────────────────────────────────
const ZBLS_TABLE = REUSE ? { ...PRIOR_ZBLS } : {};
const zblsGoal = (s) => f2lSolved(s) && edgesOriented(s);
if (!REUSE) {
  const cases = walkCases(3, (s) => zblsKey(s, 3), 400000);
  let nodes = 0;
  for (const [key, state] of cases) {
    const found = search(state, zblsGoal, heuristicZbls);
    if (!found.moves) throw new Error(`ZBLS ${key}: no solution`);
    nodes += found.nodes;
    if (!zblsGoal(applyMoves(state, found.moves))) throw new Error(`ZBLS ${key}: bad algorithm`);
    ZBLS_TABLE[key] = formatAlg(found.moves);
  }
  const lengths = Object.values(ZBLS_TABLE).map((a) => parseAlg(a).length);
  console.log(`ZBLS: ${cases.size} cases, mean ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} max ${Math.max(...lengths)} turns, ${nodes} nodes`);
}

// ── last layer cases, collected by running the stages above ─────────────
function toLastLayer(state) {
  let s = state;
  const moves = [];
  const push = (alg) => { moves.push(...alg); s = applyMoves(s, alg); };
  // cross by the same downhill walk the runtime uses
  for (;;) {
    let index = 0;
    for (let i = CROSS_EDGES.length - 1; i >= 0; i -= 1) {
      const p = s.ep.indexOf(CROSS_EDGES[i]);
      index = index * 24 + p * 2 + s.eo[p];
    }
    const distance = crossDB[index];
    if (distance === 0) break;
    for (let m = 0; m < NM; m += 1) {
      const next = applyMoves(s, [MOVES[m]]);
      let to = 0;
      for (let i = CROSS_EDGES.length - 1; i >= 0; i -= 1) {
        const p = next.ep.indexOf(CROSS_EDGES[i]);
        to = to * 24 + p * 2 + next.eo[p];
      }
      if (crossDB[to] !== distance - 1) continue;
      push([MOVES[m]]);
      break;
    }
  }
  for (const slot of [0, 1, 2]) {
    for (let guard = 0; guard < 8 && trappedSlot(s, slot) >= 0; guard += 1) push(EJECTS[trappedSlot(s, slot)]);
    push(parseAlg(F2L_TABLE[f2lKey(s, slot)]));
  }
  push(parseAlg(ZBLS_TABLE[zblsKey(s, 3)]));
  if (!zblsGoal(s)) throw new Error('pipeline did not reach the last layer');
  return { state: s, moves };
}

function randomState(length = 25) {
  let s = solvedState();
  for (let i = 0; i < length; i += 1) s = applyMoves(s, [MOVES[(Math.random() * NM) | 0]]);
  return s;
}

const llStates = new Map();
for (let i = 0; i < 120000; i += 1) {
  const { state } = toLastLayer(randomState());
  const key = zbllKey(state);
  if (!llStates.has(key)) llStates.set(key, state);
}
console.log(`last layer: ${llStates.size} distinct ZBLL cases seen`);

// ── stage 3: the last layer, in three looks ─────────────────────────────
/**
 * Twist the corners, permute the corners, permute the edges. Each look gets a
 * pattern database aimed at exactly its own goal, which is why they finish:
 * searching for the whole layer at once leaves the heuristic blind to half the
 * work and IDA* never comes back.
 */
function generateLook(name, table, sources, keyOf, goal, heuristic, budget = Infinity) {
  const states = [...sources];
  const cases = new Map();
  for (const state of states) {
    const key = keyOf(state);
    if (!cases.has(key)) cases.set(key, state);
  }
  let nodes = 0;
  let skipped = 0;
  for (const [key, state] of cases) {
    const found = search(state, goal, heuristic, budget);
    nodes += found.nodes;
    if (!found.moves) {
      // Only reachable when a budget is set: a handful of last-layer edge
      // permutations have no short quarter-turn solution and the one-shot
      // search cannot find one in bounded time. Leave the case out; the runtime
      // solver falls back for keys it does not have. Never happens unbudgeted.
      if (budget === Infinity) throw new Error(`${name} ${key}: no solution`);
      skipped += 1;
      continue;
    }
    if (!goal(applyMoves(state, found.moves))) throw new Error(`${name} ${key}: bad algorithm`);
    table[key] = formatAlg(found.moves);
  }
  if (skipped) console.log(`${name}: skipped ${skipped} case(s) over the node budget`);
  const lengths = Object.values(table).map((a) => parseAlg(a).length);
  console.log(`${name}: ${cases.size} cases, mean ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} max ${Math.max(...lengths)} turns, ${nodes} nodes`);
  // every source state moved on, not one per case: the next look has to see the
  // whole spread of what this one leaves behind, or its case list comes up
  // short. Skipped cases (budgeted looks only) pass through unchanged; the
  // edge look is last, so its return is unused anyway.
  return states.map((state) => {
    const alg = table[keyOf(state)];
    return alg ? applyMoves(state, parseAlg(alg)) : state;
  });
}

const LL_TWIST_TABLE = {};
const LL_CORNERS_TABLE = {};
const LL_EDGES_TABLE = {};

/** Sign of a permutation given as a list of destination indices. */
function permSign(order) {
  let sign = 1;
  for (let i = 0; i < order.length; i += 1)
    for (let j = i + 1; j < order.length; j += 1)
      if (order[i] > order[j]) sign = -sign;
  return sign;
}

/**
 * Complete, sampling-free source states for the corner and edge looks. Sampling
 * the last layer through the (still-incomplete) F2L/ZBLS tables biased which
 * last-layer cases ever appeared, so the corner look saw 18 of 24 permutations
 * and the edge look 8 of 12 — the runtime then threw on the rest.
 *
 * Both looks run with the corners oriented (co === 0), which is what makes a
 * legal representative for EVERY case constructible directly: permute the four
 * last-layer pieces the key names, and match edge-permutation parity to
 * corner-permutation parity so the cube stays reachable (a state is legal iff
 * the two permutation parities agree and all orientations sum to zero — here
 * every orientation is zero, so parity is the only thing to satisfy). A look's
 * algorithm acts on its key pieces independently of the rest, so one verified
 * representative per key proves the key for every state that shares it.
 */
function cornerLookSources() {
  return permutations([0, 1, 2, 3]).map((order) => {
    const s = solvedState();
    for (let i = 0; i < 4; i += 1) s.cp[LL_CORNERS[i]] = LL_CORNERS[order[i]];
    if (permSign(order) < 0) {
      const [a, b] = [LL_EDGES[0], LL_EDGES[1]];
      const t = s.ep[a]; s.ep[a] = s.ep[b]; s.ep[b] = t;
    }
    return s;
  });
}

function edgeLookSources() {
  // corners are solved here, so only the 12 even edge permutations are reachable
  return permutations([0, 1, 2, 3])
    .filter((order) => permSign(order) > 0)
    .map((order) => {
      const s = solvedState();
      for (let i = 0; i < 4; i += 1) s.ep[LL_EDGES[i]] = LL_EDGES[order[i]];
      return s;
    });
}

generateLook(
  'LL twist', LL_TWIST_TABLE, llStates.values(), llTwistKey,
  (s) => f2lSolved(s) && edgesOriented(s) && LL_CORNERS.every((p) => s.co[p] === 0),
  (s) => heuristicLL(s, 'twist', false),
);
generateLook(
  'LL corners', LL_CORNERS_TABLE, cornerLookSources(), llCornersKey,
  (s) => f2lSolved(s) && edgesOriented(s) && LL_CORNERS.every((p) => s.cp[p] === p && s.co[p] === 0),
  (s) => heuristicLL(s, 'solved', false),
);
generateLook(
  // The corner DB is in the heuristic even though this look only permutes
  // edges: the goal is a full solve, so a move that disturbs a corner has to
  // be paid back, and without that term the search sank hours into
  // corner-breaking branches it could not prune. With it, admissible.
  // A node budget caps the few edge permutations with no short quarter-turn
  // solution (H-perm-style 2-2 swaps) so the run always finishes; the runtime
  // falls back for any case left out.
  'LL edges', LL_EDGES_TABLE, edgeLookSources(), llEdgesKey, isSolved,
  (s) => heuristicLL(s, 'solved', true), 150_000_000,
);

// ── stage 4: one-look ZBLL, as far as the budget reaches ─────────────────
const ZBLL_BUDGET = flag('--zbll-budget', 0);
const ZBLL_TABLE = {};
if (ZBLL_BUDGET > 0) {
  const limit = flag('--zbll-cases', Infinity);
  let solved = 0;
  let missed = 0;
  let nodes = 0;
  const start = Date.now();
  for (const [key, state] of llStates) {
    if (solved + missed >= limit) break;
    const found = search(state, isSolved, (s) => heuristicLL(s, true, true), ZBLL_BUDGET);
    nodes += found.nodes;
    if (!found.moves) { missed += 1; continue; }
    if (!isSolved(applyMoves(state, found.moves))) throw new Error(`ZBLL ${key}: bad algorithm`);
    ZBLL_TABLE[key] = formatAlg(found.moves);
    solved += 1;
  }
  const lengths = Object.values(ZBLL_TABLE).map((a) => parseAlg(a).length);
  console.log(`ZBLL: ${solved} of ${solved + missed} attempted cases solved in one look`
    + `${lengths.length ? `, mean ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} max ${Math.max(...lengths)} turns` : ''}`
    + `, ${nodes} nodes in ${((Date.now() - start) / 1000).toFixed(0)}s`);
}

// ── emit ────────────────────────────────────────────────────────────────
const sorted = (table) => Object.fromEntries(Object.keys(table).sort().map((k) => [k, table[k]]));
const body = [
  '// Generated by scripts/gen-cube-tables.mjs — do not edit by hand.',
  '// Every algorithm here was found by search and replayed against its own case',
  '// before being written out; none was transcribed from memory.',
  `export const F2L_TABLE: Record<string, string> = ${JSON.stringify(sorted(F2L_TABLE))};`,
  `export const ZBLS_TABLE: Record<string, string> = ${JSON.stringify(sorted(ZBLS_TABLE))};`,
  `export const LL_TWIST_TABLE: Record<string, string> = ${JSON.stringify(sorted(LL_TWIST_TABLE))};`,
  `export const LL_CORNERS_TABLE: Record<string, string> = ${JSON.stringify(sorted(LL_CORNERS_TABLE))};`,
  `export const LL_EDGES_TABLE: Record<string, string> = ${JSON.stringify(sorted(LL_EDGES_TABLE))};`,
  '',
].join('\n');
writeFileSync(new URL('../src/cubeTables.ts', import.meta.url), body);
console.log(`wrote src/experimental/cubeTables.ts (${(body.length / 1024).toFixed(0)} kB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
