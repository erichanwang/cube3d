/**
 * Confirms the cube in src/experimental/RubiksChapter.tsx is never in an
 * impossible state.
 *
 * Everything here runs through the same rotateGrid() the component uses, so it
 * checks the permutation algebra those moves define:
 *
 *   1. every move is a bijection on the 27 cubelet slots
 *   2. every move preserves cubelet type — corners stay corners, edges stay
 *      edges, centres stay centres (a state violating this is unreachable on a
 *      real cube)
 *   3. each move composed with its inverse is the identity
 *   4. scramble-then-solve returns every cubelet to its exact start position
 *      AND its start orientation, so the sticker colours baked at render time
 *      still describe a solved cube at the end
 *   5. random scrambles are legal and undone by their inverse
 *   6. the CFOP solver in src/experimental/cubeSolver.ts really solves random
 *      scrambles, one stage at a time, judged by this model rather than by its
 *      own bookkeeping
 *
 * Run: node scripts/verify-cube.mjs
 */
import assert from 'node:assert/strict';
import {
  solvedState,
  applyMoves,
  solveStages,
  MOVE_TABLES,
  CORNER_COORDS,
  EDGE_COORDS,
} from '../src/cubeSolver.ts';

// Mirrors MOVE_DEFS in RubiksChapter.tsx.
const MOVE_DEFS = {
  R: { axis: 'X', pick: (c) => c.x === 1, sign: -1 },
  L: { axis: 'X', pick: (c) => c.x === -1, sign: 1 },
  U: { axis: 'Y', pick: (c) => c.y === -1, sign: 1 },
  D: { axis: 'Y', pick: (c) => c.y === 1, sign: -1 },
  F: { axis: 'Z', pick: (c) => c.z === 1, sign: 1 },
  B: { axis: 'Z', pick: (c) => c.z === -1, sign: -1 },
  M: { axis: 'X', pick: (c) => c.x === 0, sign: 1 },
  E: { axis: 'Y', pick: (c) => c.y === 0, sign: -1 },
  S: { axis: 'Z', pick: (c) => c.z === 0, sign: 1 },
  r: { axis: 'X', pick: (c) => c.x >= 0, sign: -1 },
  l: { axis: 'X', pick: (c) => c.x <= 0, sign: 1 },
  u: { axis: 'Y', pick: (c) => c.y <= 0, sign: 1 },
  d: { axis: 'Y', pick: (c) => c.y >= 0, sign: -1 },
  f: { axis: 'Z', pick: (c) => c.z >= 0, sign: 1 },
  b: { axis: 'Z', pick: (c) => c.z <= 0, sign: -1 },
  x: { axis: 'X', pick: () => true, sign: -1 },
  y: { axis: 'Y', pick: () => true, sign: 1 },
  z: { axis: 'Z', pick: () => true, sign: 1 },
};

// Mirrors SOLVE in RubiksChapter.tsx.
const SOLVE = [
  { face: 'R' }, { face: 'U' }, { face: 'R', prime: true }, { face: 'U', prime: true },
  { face: 'F' }, { face: 'R', prime: true }, { face: 'F', prime: true }, { face: 'R' },
  { face: 'U' }, { face: 'U' }, { face: 'R' }, { face: 'U', prime: true },
  { face: 'R', prime: true }, { face: 'U' }, { face: 'R' }, { face: 'U' },
  { face: 'R', prime: true },
];

/** Mirrors rotateGrid(): the same three 90-degree rotation matrices. */
function rotateGrid(axis, sign, cube) {
  const { x, y, z } = cube;
  if (axis === 'X') { cube.y = -sign * z; cube.z = sign * y; }
  if (axis === 'Y') { cube.x = sign * z; cube.z = -sign * x; }
  if (axis === 'Z') { cube.x = -sign * y; cube.y = sign * x; }
}

/** The same rotation applied to a cubelet's 3x3 orientation matrix. */
function rotateOrientation(axis, sign, m) {
  const R =
    axis === 'X' ? [[1, 0, 0], [0, 0, -sign], [0, sign, 0]]
      : axis === 'Y' ? [[0, 0, sign], [0, 1, 0], [-sign, 0, 0]]
        : [[0, -sign, 0], [sign, 0, 0], [0, 0, 1]];
  return R.map((row) => [0, 1, 2].map((j) => row[0] * m[0][j] + row[1] * m[1][j] + row[2] * m[2][j]));
}

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function freshCube() {
  const cubes = [];
  for (let x = -1; x <= 1; x += 1)
    for (let y = -1; y <= 1; y += 1)
      for (let z = -1; z <= 1; z += 1)
        cubes.push({ id: `${x},${y},${z}`, x, y, z, m: IDENTITY });
  return cubes;
}

/** Number of non-zero coordinates: 3 = corner, 2 = edge, 1 = centre, 0 = core. */
const kind = (c) => Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z);

function applyMove(cubes, move, direction) {
  const def = MOVE_DEFS[move.face];
  const sign = def.sign * (move.prime ? -1 : 1) * direction;
  const turns = move.turns ?? 1;
  for (let turn = 0; turn < turns; turn += 1) {
    for (const cube of cubes) {
      if (!def.pick(cube)) continue;
      rotateGrid(def.axis, sign, cube);
      cube.m = rotateOrientation(def.axis, sign, cube.m);
    }
  }
}

function assertValid(cubes, when) {
  const seen = new Set();
  for (const cube of cubes) {
    for (const v of [cube.x, cube.y, cube.z]) {
      assert.ok(v === -1 || v === 0 || v === 1, `${when}: coordinate off the lattice`);
    }
    const slot = `${cube.x},${cube.y},${cube.z}`;
    assert.ok(!seen.has(slot), `${when}: two cubelets share slot ${slot}`);
    seen.add(slot);
  }
  assert.equal(seen.size, 27, `${when}: expected 27 occupied slots, got ${seen.size}`);
}

// ── 1 & 2: every outer, slice, wide, and rotation move is a type-preserving bijection ──
for (const face of Object.keys(MOVE_DEFS)) {
  for (const prime of [false, true]) {
    const cubes = freshCube();
    const before = new Map(cubes.map((c) => [c.id, kind(c)]));
    applyMove(cubes, { face, prime }, 1);
    assertValid(cubes, `${face}${prime ? "'" : ''}`);
    for (const cube of cubes) {
      assert.equal(kind(cube), before.get(cube.id), `${face}: cubelet ${cube.id} changed type`);
    }
  }
}

// ── 3: move composed with its inverse is the identity ───────────────────
for (const face of Object.keys(MOVE_DEFS)) {
  const cubes = freshCube();
  applyMove(cubes, { face }, 1);
  applyMove(cubes, { face }, -1);
  for (const cube of cubes) {
    const [x, y, z] = cube.id.split(',').map(Number);
    assert.deepEqual([cube.x, cube.y, cube.z], [x, y, z], `${face} then ${face}' moved ${cube.id}`);
    assert.deepEqual(cube.m, IDENTITY, `${face} then ${face}' twisted ${cube.id}`);
  }
}

// ── 4: the component's own cycle — scramble backwards, solve forwards ───
const cubes = freshCube();
for (let i = SOLVE.length - 1; i >= 0; i -= 1) {
  applyMove(cubes, SOLVE[i], -1);
  assertValid(cubes, `scramble step ${SOLVE.length - i}`);
}

// the scramble must actually disturb the cube, or the "solve" shows nothing
const moved = cubes.filter((c) => c.id !== `${c.x},${c.y},${c.z}`).length;
assert.ok(moved > 0, 'scramble left the cube solved');

for (let i = 0; i < SOLVE.length; i += 1) {
  applyMove(cubes, SOLVE[i], 1);
  assertValid(cubes, `solve step ${i + 1}`);
}

for (const cube of cubes) {
  const [x, y, z] = cube.id.split(',').map(Number);
  assert.deepEqual([cube.x, cube.y, cube.z], [x, y, z], `cubelet ${cube.id} ended out of place`);
  assert.deepEqual(cube.m, IDENTITY, `cubelet ${cube.id} ended twisted`);
}

// ── 5: random scrambles are always legal, and their inverse always solves ──
const FACE_KEYS = ['R', 'L', 'U', 'D', 'F', 'B'];
const OPPOSITE = { R: 'L', L: 'R', U: 'D', D: 'U', F: 'B', B: 'F' };

function randomScramble(length = 22) {
  const moves = [];
  let last = '';
  let beforeLast = '';
  while (moves.length < length) {
    const face = FACE_KEYS[Math.floor(Math.random() * FACE_KEYS.length)];
    if (face === last) continue;
    if (face === beforeLast && OPPOSITE[last] === face) continue;
    moves.push({ face, prime: Math.random() < 0.5 });
    beforeLast = last;
    last = face;
  }
  return moves;
}

const inverseOf = (moves) => moves.map((m) => ({ face: m.face, prime: !m.prime })).reverse();

const TRIALS = 500;
let totalDisplaced = 0;
for (let trial = 0; trial < TRIALS; trial += 1) {
  const state = freshCube();
  const moves = randomScramble();
  for (const move of moves) {
    applyMove(state, move, 1);
    assertValid(state, `random scramble trial ${trial}`);
  }
  totalDisplaced += state.filter((c) => c.id !== `${c.x},${c.y},${c.z}`).length;

  for (const move of inverseOf(moves)) {
    applyMove(state, move, 1);
    assertValid(state, `random solve trial ${trial}`);
  }
  for (const cube of state) {
    const [x, y, z] = cube.id.split(',').map(Number);
    assert.deepEqual([cube.x, cube.y, cube.z], [x, y, z], `trial ${trial}: ${cube.id} out of place`);
    assert.deepEqual(cube.m, IDENTITY, `trial ${trial}: ${cube.id} left twisted`);
  }
}

// ── 6: the CFOP solver, judged by this model rather than its own ────────
/**
 * The solver keeps its own cubie state; this section never trusts it. Each
 * scramble is applied to a fresh 27-cubelet cube, the solver is asked for its
 * stages, and every stage's promise is checked here against the cubelets:
 * cross, then F2L, then last-layer edges oriented after ZBLS, then solved.
 *
 * Centres are exempt from the orientation check: a centre only ever spins about
 * its own axis, so its single coloured face still points outward and the cube
 * still reads as solved.
 */
const IDENT = (c) => c.m.every((row, i) => row.every((v, j) => v === (i === j ? 1 : 0)));
const home = (c) => c.id.split(',').map(Number);
const inPlace = (c) => { const [x, y, z] = home(c); return c.x === x && c.y === y && c.z === z; };
const settled = (c) => inPlace(c) && IDENT(c);
const isEdge = (c) => kind(c) === 2;

const crossPieces = (s) => s.filter((c) => isEdge(c) && home(c)[1] === 1);
const f2lPieces = (s) => s.filter((c) => kind(c) >= 2 && (home(c)[1] === 1 || (isEdge(c) && home(c)[1] === 0)));
const llEdges = (s) => s.filter((c) => isEdge(c) && home(c)[1] === -1);
/** The U/D sticker of a last-layer edge still points up or down. */
const orientedEdge = (c) => c.m[0][1] === 0 && c.m[2][1] === 0;
const coordinateKey = (v) => v.join(',');
const modelCoordinate = (c) => [c.x, c.y, c.z];
const matrixKey = (m) => m.flat().join(',');
const IDENTITY_MATRIX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * Build an orientation lookup for one piece from the same outer-turn tables
 * used by the solver and the same orientation matrices used by the DOM model.
 * This makes the per-move parity check cover co/eo, not just positions.
 */
function buildOrientationMaps(coords, isCorner) {
  return coords.map((homeCoord, piece) => {
    const map = new Map();
    const queue = [{
      position: [...homeCoord],
      matrix: IDENTITY_MATRIX,
      orientation: 0,
    }];
    while (queue.length) {
      const current = queue.shift();
      const stateKey = `${coordinateKey(current.position)}|${matrixKey(current.matrix)}`;
      if (map.has(stateKey)) continue;
      map.set(stateKey, current.orientation);
      const position = coords.findIndex((v) => coordinateKey(v) === coordinateKey(current.position));
      for (let moveIndex = 0; moveIndex < 12; moveIndex += 1) {
        const face = FACE_KEYS[Math.floor(moveIndex / 2)];
        const def = MOVE_DEFS[face];
        if (!def.pick({ x: current.position[0], y: current.position[1], z: current.position[2] })) continue;
        const sign = def.sign * (moveIndex % 2 ? -1 : 1);
        const nextPosition = isCorner
          ? CORNER_COORDS[MOVE_TABLES.cornerPerm[moveIndex][position]]
          : EDGE_COORDS[MOVE_TABLES.edgePerm[moveIndex][position]];
        const nextMatrix = rotateOrientation(def.axis, sign, current.matrix);
        const nextOrientation = isCorner
          ? MOVE_TABLES.cornerTwist[moveIndex][position * 3 + current.orientation]
          : current.orientation ^ MOVE_TABLES.edgeFlip[moveIndex][position];
        queue.push({ position: [...nextPosition], matrix: nextMatrix, orientation: nextOrientation });
      }
    }
    return map;
  });
}

const cornerOrientationMaps = buildOrientationMaps(CORNER_COORDS, true);
const edgeOrientationMaps = buildOrientationMaps(EDGE_COORDS, false);

/** Compare the independent 27-cubelet model with the solver's complete state. */
function assertModelMatchesState(cubes, state, when) {
  for (const cube of cubes) {
    const homeCoord = home(cube);
    const currentCoord = modelCoordinate(cube);
    const sum = Math.abs(homeCoord[0]) + Math.abs(homeCoord[1]) + Math.abs(homeCoord[2]);
    if (sum === 3) {
      const piece = CORNER_COORDS.findIndex((v) => coordinateKey(v) === coordinateKey(homeCoord));
      const position = state.cp.indexOf(piece);
      assert.equal(coordinateKey(currentCoord), coordinateKey(CORNER_COORDS[position]), `${when}: corner position diverged`);
      const expected = cornerOrientationMaps[piece].get(`${coordinateKey(currentCoord)}|${matrixKey(cube.m)}`);
      assert.equal(expected, state.co[position], `${when}: corner orientation diverged`);
    } else if (sum === 2) {
      const piece = EDGE_COORDS.findIndex((v) => coordinateKey(v) === coordinateKey(homeCoord));
      const position = state.ep.indexOf(piece);
      assert.equal(coordinateKey(currentCoord), coordinateKey(EDGE_COORDS[position]), `${when}: edge position diverged`);
      const expected = edgeOrientationMaps[piece].get(`${coordinateKey(currentCoord)}|${matrixKey(cube.m)}`);
      assert.equal(expected, state.eo[position], `${when}: edge orientation diverged`);
    }
  }
}

const SOLVE_TRIALS = 2000;
const SCRAMBLE_LENGTH = 30;
const ALL_MOVES = FACE_KEYS.flatMap((face) => [{ face }, { face, prime: true }]);

let totalMoves = 0;
let maxMoves = 0;
let minMoves = Infinity;
const stageTotals = new Map();

for (let trial = 0; trial < SOLVE_TRIALS; trial += 1) {
  const cubes = freshCube();
  const scramble = Array.from({ length: SCRAMBLE_LENGTH }, () => ALL_MOVES[Math.floor(Math.random() * ALL_MOVES.length)]);
  for (const move of scramble) applyMove(cubes, move, 1);

  // A missing F2L, ZBLS, or ZBLL case is a solver failure. Do not turn it into
  // a warning or silently substitute a rewind: the verifier must fail hard.
  const stages = solveStages(applyMoves(solvedState(), scramble));
  assert.deepEqual(stages.map((s) => s.stage), ['Cross', 'F2L', 'F2L', 'F2L', 'ZBLS', 'ZBLL'],
    `trial ${trial}: unexpected stage list`);

  let moves = 0;
  let solverCursor = applyMoves(solvedState(), scramble);
  for (const stage of stages) {
    for (const move of stage.moves) {
      applyMove(cubes, move, 1);
      solverCursor = applyMoves(solverCursor, [move]);
      assertValid(cubes, `trial ${trial} ${stage.stage} move ${moves + 1}`);
      assertModelMatchesState(cubes, solverCursor, `trial ${trial} ${stage.stage} move ${moves + 1}`);
      moves += 1;
    }
    assertValid(cubes, `trial ${trial} ${stage.stage}`);
    stageTotals.set(stage.stage, (stageTotals.get(stage.stage) ?? 0) + stage.moves.length);

    assert.ok(crossPieces(cubes).every(settled), `trial ${trial}: cross broken after ${stage.stage}`);
    if (stage.stage !== 'Cross') {
      const done = stages.indexOf(stage);
      const slots = f2lPieces(cubes).filter(settled).length;
      // three slots after the third F2L look, all of them from ZBLS onwards
      const required = stage.stage === 'F2L' ? 4 + 2 * done : 12;
      assert.ok(slots >= required, `trial ${trial}: only ${slots} F2L pieces settled after ${stage.stage}`);
    }
    if (stage.stage === 'ZBLS') {
      assert.ok(llEdges(cubes).every(orientedEdge), `trial ${trial}: ZBLS left a last-layer edge flipped`);
    }
  }
  for (const cube of cubes) {
    if (kind(cube) < 2) continue;
    assert.ok(settled(cube), `trial ${trial}: cubelet ${cube.id} unsolved after ZBLL`);
  }
  totalMoves += moves;
  maxMoves = Math.max(maxMoves, moves);
  minMoves = Math.min(minMoves, moves);
}

const solverSolved = SOLVE_TRIALS;

console.log(`ok — ${Object.keys(MOVE_DEFS).length * 2} outer/slice/wide/rotation moves are type-preserving bijections`);
console.log(`ok — every move undone by its inverse, position and orientation`);
console.log(`ok — scramble displaced ${moved}/27 cubelets, solve restored all of them`);
console.log(`ok — ${TRIALS} random scrambles all legal, all solved by their inverse`);
console.log(`     (mean ${(totalDisplaced / TRIALS).toFixed(1)}/27 cubelets displaced per scramble)`);
const pct = ((solverSolved / SOLVE_TRIALS) * 100).toFixed(1);
console.log(`ok — CFOP solver: ${solverSolved}/${SOLVE_TRIALS} scrambles (${pct}%) solved one-look, every stage invariant held`);
if (solverSolved) {
  console.log(`     ${(totalMoves / solverSolved).toFixed(1)} turns mean, ${minMoves} min, ${maxMoves} max`);
  for (const [stage, total] of stageTotals) {
    console.log(`     ${stage.padEnd(5)} ${(total / solverSolved).toFixed(1)} turns mean`);
  }
}
console.log('cube reaches only legal states');
