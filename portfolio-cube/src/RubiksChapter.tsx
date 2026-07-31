import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { CubeMove } from './types';
import {
  applyMoves,
  solveStages,
  solvedState,
  CORNER_COORDS,
  CROSS_EDGES,
  EDGE_COORDS,
  LL_EDGES,
  SLOTS,
  type CubeState,
  type StageName,
} from './cubeSolver';

const FACE_KEYS = ['R', 'L', 'U', 'D', 'F', 'B'] as const;
/** Faces that cancel or commute with each other, used to reject dud scrambles. */
const OPPOSITE: Record<string, string> = { R: 'L', L: 'R', U: 'D', D: 'U', F: 'B', B: 'F' };

/**
 * A competition-style random scramble: no move on the face just turned (it
 * would merge into one turn) and no three-in-a-row on an opposing pair (F B F
 * is the same as B F F). Every state it reaches is legal by construction — it
 * is a sequence of legal quarter-turns applied to a solved cube — and
 * scripts/verify-cube.mjs checks that over many random scrambles.
 */
function randomScramble(length = 22): CubeMove[] {
  const moves: CubeMove[] = [];
  let last = '';
  let beforeLast = '';
  while (moves.length < length) {
    const face = FACE_KEYS[Math.floor(Math.random() * FACE_KEYS.length)]!;
    if (face === last) continue;
    if (face === beforeLast && OPPOSITE[last] === face) continue;
    moves.push({ face, prime: Math.random() < 0.5 });
    beforeLast = last;
    last = face;
  }
  return moves;
}

/** One planned quarter-turn, tagged with the CFOP stage that asked for it. */
interface PlannedMove { move: CubeMove; stage: StageName; slot?: number; caseLabel?: string }

/**
 * White on the bottom, yellow on top: CFOP builds its cross on the D face, so
 * the white cross has to be the one you watch form underneath. Green front,
 * blue back, red right, orange left as usual.
 */
// Vivid stickerless shades, in the spirit of a MoYu WeiLong V10 WRM: the plastic
// itself is the colour, so these are brighter and more saturated than sticker
// paint, and the sheen/bevel comes from .xp-cube-face rather than the swatch.
const COLORS = { u: '#ffd51e', d: '#f1f3f1', f: '#08b45c', b: '#1a52dc', r: '#e11d2c', l: '#ff7a17' };
/** Pace of the solve. The clock reports whatever the sequence actually takes. */
const STEP_MS = 67;
const STEP_PAUSE_MS = 180;
const STAGE_PAUSE_MS = 650;
const FACES = ['u', 'd', 'f', 'b', 'r', 'l'] as const;

interface CubeletRuntime {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  matrix: DOMMatrix;
}

const MOVE_DEFS = {
  R: { axis: 'X', pick: (cube: CubeletRuntime) => cube.x === 1, sign: -1 },
  L: { axis: 'X', pick: (cube: CubeletRuntime) => cube.x === -1, sign: 1 },
  U: { axis: 'Y', pick: (cube: CubeletRuntime) => cube.y === -1, sign: 1 },
  D: { axis: 'Y', pick: (cube: CubeletRuntime) => cube.y === 1, sign: -1 },
  F: { axis: 'Z', pick: (cube: CubeletRuntime) => cube.z === 1, sign: 1 },
  B: { axis: 'Z', pick: (cube: CubeletRuntime) => cube.z === -1, sign: -1 },
} as const;

function rotateGrid(axis: string, sign: number, cube: CubeletRuntime) {
  const { x, y, z } = cube;
  if (axis === 'X') { cube.y = -sign * z; cube.z = sign * y; }
  if (axis === 'Y') { cube.x = sign * z; cube.z = -sign * x; }
  if (axis === 'Z') { cube.x = -sign * y; cube.y = sign * x; }
}

function stickerColor(face: typeof FACES[number], x: number, y: number, z: number) {
  const visible = face === 'u' ? y === -1
    : face === 'd' ? y === 1
      : face === 'f' ? z === 1
        : face === 'b' ? z === -1
          : face === 'r' ? x === 1
            : x === -1;
  // inner faces are the dark cube core, kept thin by the tight gaps
  return visible ? COLORS[face] : '#141519';
}

const coordinateKey = (coordinate: readonly number[]) => coordinate.join(',');

function stageKey(planned: PlannedMove | undefined) {
  if (!planned) return '';
  return `${planned.stage}:${planned.stage === 'F2L' ? planned.slot ?? -1 : ''}`;
}

/** Derived from the slot coordinates: keep the active pair's side facing the viewer. */
const SLOT_YAWS = SLOTS.map(({ corner }) => {
  const [x, , z] = CORNER_COORDS[corner]!;
  return 36 + (x === 1 ? (z === 1 ? 0 : 90) : (z === 1 ? -90 : 180));
});

export function RubiksChapter() {
  const sectionRef = useRef<HTMLElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const pivotRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const runtimes = useRef<CubeletRuntime[]>([]);
  const applied = useRef(0);
  const busy = useRef(false);
  const finishTimer = useRef(0);
  const stepTimer = useRef(0);
  const frames = useRef<number[]>([]);
  /** Synchronously commits an in-flight turn before seek/step controls mutate it. */
  const flushMove = useRef<(() => void) | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  // A real clock: it starts when playback starts and stops when playback is
  // paused or the final quarter-turn is complete. It is independent of scroll.
  const [clock, setClock] = useState(0);
  /** Elapsed time carried across pauses, so the clock resumes rather than restarts. */
  const clockRef = useRef(0);
  clockRef.current = clock;
  /** The turns still to play, each tagged with the stage that planned it. */
  const plan = useRef<PlannedMove[]>([]);
  const [planLength, setPlanLength] = useState(0);
  const [stage, setStage] = useState<StageName | null>(null);
  const [caseLabel, setCaseLabel] = useState<string | null>(null);
  const visualSlot = useRef<number | null>(null);
  // Mirrored into state so the scramble and the tagged solve can be rendered:
  // the scramble sits above the cube, the CFOP solve moves below it.
  const [scrambleSeq, setScrambleSeq] = useState<CubeMove[]>([]);
  const [planMoves, setPlanMoves] = useState<PlannedMove[]>([]);

  /** Highlight the physical pieces for the stage currently being executed. */
  const highlightTarget = useCallback((planned: PlannedMove | undefined) => {
    const cube = cubeRef.current;
    if (!cube) return;
    const targets = new Set<string>();
    if (planned?.stage === 'Cross') {
      CROSS_EDGES.forEach((piece) => targets.add(coordinateKey(EDGE_COORDS[piece]!)));
    } else if (planned?.stage === 'F2L' && planned.slot !== undefined) {
      const slot = SLOTS[planned.slot]!;
      targets.add(coordinateKey(CORNER_COORDS[slot.corner]!));
      targets.add(coordinateKey(EDGE_COORDS[slot.edge]!));
    } else if (planned?.stage === 'ZBLS') {
      LL_EDGES.forEach((piece) => targets.add(coordinateKey(EDGE_COORDS[piece]!)));
    }
    cube.querySelectorAll<HTMLElement>('.xp-cubelet').forEach((cubelet) => {
      const key = coordinateKey([
        Number(cubelet.dataset.x),
        Number(cubelet.dataset.y),
        Number(cubelet.dataset.z),
      ]);
      cubelet.classList.toggle('is-highlighted', targets.has(key));
    });
  }, []);
  /**
   * The cube the solver reasons about, kept in step with the DOM one turn for
   * turn. Solving from this rather than from "solved plus the scramble I just
   * made up" is what lets Scramble interrupt a solve half way through.
   */
  const cubeState = useRef<CubeState>(solvedState());

  const solved = moveCount >= planLength;

  useEffect(() => {
    if (!isPlaying || solved) return;
    const startedAt = performance.now();
    const base = clockRef.current;
    let frame = requestAnimationFrame(function tick() {
      setClock(base + (performance.now() - startedAt) / 1000);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // clockRef is read once as the resume point, deliberately not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, solved]);

  const bakeMove = useCallback((move: CubeMove, direction: 1 | -1, animate: boolean, done?: () => void) => {
    const cube = cubeRef.current;
    const pivot = pivotRef.current;
    if (!cube || !pivot) return;
    const definition = MOVE_DEFS[move.face];
    const sign = definition.sign * (move.prime ? -1 : 1) * direction;
    const layer = runtimes.current.filter(definition.pick);
    cubeState.current = applyMoves(cubeState.current, [direction === 1 ? move : { face: move.face, prime: !move.prime }]);
    const bake = () => {
      window.clearTimeout(finishTimer.current);
      if (flushMove.current === bake) flushMove.current = null;
      for (const item of layer) {
        item.matrix = new DOMMatrix(`rotate${definition.axis}(${sign * 90}deg)`).multiply(item.matrix);
        rotateGrid(definition.axis, sign, item);
        item.el.style.transform = item.matrix.toString();
        cube.insertBefore(item.el, pivot);
      }
      pivot.classList.remove('is-turning');
      pivot.style.transform = '';
      done?.();
    };

    if (!animate) {
      bake();
      return;
    }
    flushMove.current = bake;
    layer.forEach((item) => pivot.appendChild(item.el));
    pivot.classList.add('is-turning');
    // one duration for every turn, just under the step so each finishes before
    // the next begins
    pivot.style.setProperty('--turn-duration', `${Math.round(STEP_MS * 0.86)}ms`);
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => {
        pivot.style.transform = `rotate${definition.axis}(${sign * 90}deg)`;
      });
      frames.current.push(second);
    });
    frames.current.push(first);
    finishTimer.current = window.setTimeout(bake, STEP_MS);
  }, []);

  const orientToSlot = useCallback((planned: PlannedMove | undefined) => {
    const cube = cubeRef.current;
    if (!cube) return;
    if (planned?.stage !== 'F2L' || planned.slot === undefined) {
      if (visualSlot.current === null) return;
      visualSlot.current = null;
      cube.classList.add('is-auto-orienting');
      cube.style.setProperty('--cube-ry', '36deg');
      return;
    }
    if (planned.slot === visualSlot.current) return;
    const yaw = SLOT_YAWS[planned.slot] ?? 36;
    visualSlot.current = planned.slot;
    cube.classList.add('is-auto-orienting');
    cube.style.setProperty('--cube-ry', `${yaw}deg`);
  }, []);

  const pump = useCallback(() => {
    if (reduceMotion || !isPlayingRef.current || busy.current || applied.current >= plan.current.length) return;
    const planned = plan.current[applied.current];
    if (!planned) return;
    busy.current = true;
    applied.current += 1;
    setStage(planned.stage);
    highlightTarget(planned);
    orientToSlot(planned);
    bakeMove(planned.move, 1, !document.hidden, () => {
      setMoveCount(applied.current);
      busy.current = false;
      if (applied.current >= plan.current.length) {
        isPlayingRef.current = false;
        setIsPlaying(false);
      } else if (isPlayingRef.current) {
        const next = plan.current[applied.current];
        const stageChanged = stageKey(next) !== stageKey(planned);
        const pause = stageChanged ? STAGE_PAUSE_MS : STEP_PAUSE_MS;
        setStage(next?.stage ?? null);
        highlightTarget(next);
        orientToSlot(next);
        stepTimer.current = window.setTimeout(pump, STEP_MS + pause);
      }
    });
  }, [bakeMove, highlightTarget, orientToSlot, reduceMotion]);

  /* Stop scheduled playback and finish the current visual turn synchronously. */
  const stopAndFlush = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    window.clearTimeout(stepTimer.current);
    frames.current.forEach(cancelAnimationFrame);
    frames.current = [];
    flushMove.current?.();
    busy.current = false;
  }, []);

  const updateReadout = useCallback((cursor: number) => {
    const next = plan.current[cursor];
    setMoveCount(cursor);
    const target = next ?? (cursor > 0 ? plan.current[cursor - 1] : undefined);
    setStage(target?.stage ?? null);
    setCaseLabel(plan.current.find((planned) => planned.caseLabel)?.caseLabel ?? null);
    highlightTarget(target);
    orientToSlot(target);
  }, [highlightTarget, orientToSlot]);

  const stepForward = useCallback(() => {
    if (reduceMotion) return;
    stopAndFlush();
    if (applied.current >= plan.current.length) return;
    const planned = plan.current[applied.current];
    if (!planned) return;
    busy.current = true;
    applied.current += 1;
    setStage(planned.stage);
    highlightTarget(planned);
    orientToSlot(planned);
    bakeMove(planned.move, 1, true, () => {
      updateReadout(applied.current);
      busy.current = false;
    });
  }, [bakeMove, highlightTarget, orientToSlot, reduceMotion, stopAndFlush, updateReadout]);

  const stepBackward = useCallback(() => {
    if (reduceMotion) return;
    stopAndFlush();
    if (applied.current <= 0) return;
    const planned = plan.current[applied.current - 1];
    if (!planned) return;
    applied.current -= 1;
    highlightTarget(plan.current[applied.current]);
    orientToSlot(plan.current[applied.current]);
    busy.current = true;
    bakeMove(planned.move, -1, true, () => {
      updateReadout(applied.current);
      busy.current = false;
    });
  }, [bakeMove, highlightTarget, orientToSlot, reduceMotion, stopAndFlush, updateReadout]);

  const seekTo = useCallback((target: number) => {
    if (reduceMotion) return;
    stopAndFlush();
    const clamped = Math.max(0, Math.min(target, plan.current.length));
    while (applied.current < clamped) {
      const planned = plan.current[applied.current];
      if (!planned) break;
      highlightTarget(planned);
      orientToSlot(planned);
      applied.current += 1;
      bakeMove(planned.move, 1, false);
    }
    while (applied.current > clamped) {
      const planned = plan.current[applied.current - 1];
      if (!planned) break;
      applied.current -= 1;
      bakeMove(planned.move, -1, false);
    }
    updateReadout(applied.current);
  }, [bakeMove, highlightTarget, orientToSlot, reduceMotion, stopAndFlush, updateReadout]);

  const togglePlayback = useCallback(() => {
    if (reduceMotion || solved) return;
    if (isPlayingRef.current) {
      stopAndFlush();
      return;
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    pump();
  }, [pump, reduceMotion, solved, stopAndFlush]);

  /**
   * Plan the actual CFOP solve for the current cubie state. The solver now has
   * complete F2L, ZBLS, and canonical one-look ZBLL coverage, so a missing case
   * is an implementation error rather than a reason to silently rewind.
   */
  const planSolve = useCallback(() => {
    const stages = solveStages(cubeState.current);
    plan.current = stages
      .flatMap((entry) => entry.moves.map((move) => ({ move, stage: entry.stage, slot: entry.slot, caseLabel: entry.caseLabel })));
    visualSlot.current = null;
    applied.current = 0;
    setPlanLength(plan.current.length);
    setPlanMoves(plan.current);
    setMoveCount(0);
    setStage(plan.current[0]?.stage ?? null);
    setCaseLabel(plan.current.find((planned) => planned.caseLabel)?.caseLabel ?? null);
  }, []);

  /** Scramble: drop a fresh random sequence on with no animation, then solve. */
  const scramble = useCallback(() => {
    if (reduceMotion) return;
    stopAndFlush();
    highlightTarget(undefined);

    const moves = randomScramble();
    setScrambleSeq(moves);
    for (const move of moves) bakeMove(move, 1, false);
    planSolve();
    setClock(0);
    isPlayingRef.current = true;
    setIsPlaying(true);
    stepTimer.current = window.setTimeout(pump, 550);
  }, [bakeMove, highlightTarget, planSolve, pump, reduceMotion, stopAndFlush]);

  useEffect(() => {
    const cube = cubeRef.current;
    const pivot = pivotRef.current;
    if (!cube || !pivot) return;
    const step = Number.parseFloat(getComputedStyle(cube).getPropertyValue('--cube-step')) || 74;
    runtimes.current = Array.from(cube.querySelectorAll<HTMLDivElement>('.xp-cubelet')).map((el) => {
      const x = Number(el.dataset.x);
      const y = Number(el.dataset.y);
      const z = Number(el.dataset.z);
      const matrix = new DOMMatrix().translate(x * step, y * step, z * step);
      el.style.transform = matrix.toString();
      return { el, x, y, z, matrix };
    });
    applied.current = 0;
    cubeState.current = solvedState();

    // start fully scrambled on a fresh random sequence
    if (!reduceMotion) {
      const moves = randomScramble();
      setScrambleSeq(moves);
      for (const move of moves) bakeMove(move, 1, false);
      planSolve();
    }

    // and begin solving the first time the chapter is actually on screen
    const section = sectionRef.current;
    let observer: IntersectionObserver | undefined;
    if (section && !reduceMotion) {
      observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) return;
        observer?.disconnect();
        isPlayingRef.current = true;
        setIsPlaying(true);
        stepTimer.current = window.setTimeout(pump, 400);
      }, { threshold: 0.35 });
      observer.observe(section);
    }

    return () => {
      observer?.disconnect();
      window.clearTimeout(stepTimer.current);
      window.clearTimeout(finishTimer.current);
      frames.current.forEach(cancelAnimationFrame);
      frames.current = [];
      Array.from(pivot.children).forEach((child) => cube.insertBefore(child, pivot));
      pivot.classList.remove('is-turning');
      pivot.style.transform = '';
      runtimes.current.forEach((item) => { item.el.style.transform = ''; });
      runtimes.current = [];
      busy.current = false;
      isPlayingRef.current = false;
      setIsPlaying(false);
      highlightTarget(undefined);
    };
  }, [bakeMove, highlightTarget, planSolve, pump, reduceMotion]);

  /**
   * Drag to look around. The view angle lives in CSS variables on the cube
   * element, so turning a layer and orbiting the whole cube never fight over
   * the same transform.
   */
  const view = useRef({ rx: -26, ry: 36, x: 0, y: 0, dragging: false });
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    view.current.dragging = true;
    view.current.x = event.clientX;
    view.current.y = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!view.current.dragging || !cubeRef.current) return;
    cubeRef.current.classList.remove('is-auto-orienting');
    view.current.ry += (event.clientX - view.current.x) * 0.45;
    // stop short of the poles, where a horizontal drag stops meaning anything
    view.current.rx = Math.min(80, Math.max(-80, view.current.rx - (event.clientY - view.current.y) * 0.45));
    view.current.x = event.clientX;
    view.current.y = event.clientY;
    cubeRef.current.style.setProperty('--cube-rx', `${view.current.rx}deg`);
    cubeRef.current.style.setProperty('--cube-ry', `${view.current.ry}deg`);
  }, []);
  const endDrag = useCallback(() => { view.current.dragging = false; }, []);

  const coordinates: Array<[number, number, number]> = [];
  for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) coordinates.push([x, y, z]);

  // The solve, grouped into its CFOP stages (consecutive same-stage moves are
  // one run), each move tagged with its position so the render can light up
  // whatever has already been played.
  const stageGroups = useMemo(() => {
    const groups: Array<{ stage: StageName; caseLabel?: string; moves: Array<{ move: CubeMove; index: number }> }> = [];
    planMoves.forEach((planned, index) => {
      const last = groups[groups.length - 1];
      if (last && last.stage === planned.stage) {
        last.moves.push({ move: planned.move, index });
        last.caseLabel ??= planned.caseLabel;
      } else groups.push({ stage: planned.stage, caseLabel: planned.caseLabel, moves: [{ move: planned.move, index }] });
    });
    return groups;
  }, [planMoves]);

  return (
    <section ref={sectionRef} className="xp-cube-chapter" aria-labelledby="cube-title">
      <div className="xp-cube-frame">
        <div className="xp-cube-copy">
          <p className="xp-mono">Rubik's Cube Simulation</p>
          <h3 id="cube-title">A solve you can watch think.</h3>
          <p>Starts on a random scramble and solves it by CFOP — white cross, three F2L pairs, then ZBLS and ZBLL for the last layer. One quarter-turn at a time; drag the cube to look around.</p>
          <div className="xp-cube-actions">
            <button type="button" onClick={scramble} disabled={Boolean(reduceMotion)}>Scramble</button>
            <a href="https://github.com/erichanwang/cube3d" target="_blank" rel="noreferrer">View source</a>
          </div>
        </div>
        {scrambleSeq.length > 0 && (
          <div className="xp-cube-scramble" aria-hidden="true">
            <span className="xp-cube-tape-label">Scramble</span>
            <span className="xp-cube-tape">
              {scrambleSeq.map((move, i) => <b key={i}>{move.face}{move.prime ? '′' : ''}</b>)}
            </span>
          </div>
        )}
        <div
          className="xp-cube-visual"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div ref={cubeRef} className="xp-cube">
            {coordinates.map(([x, y, z]) => (
              <div key={`${x}-${y}-${z}`} className="xp-cubelet" data-x={x} data-y={y} data-z={z}>
                {FACES.map((face) => <span key={face} className={`xp-cube-face ${face}`} style={{ backgroundColor: stickerColor(face, x, y, z) }} />)}
              </div>
            ))}
            <div ref={pivotRef} className="xp-cube-pivot" />
          </div>
        </div>
        {/* The CFOP solve is a clickable timeline: white moves are still ahead;
            an executed move dulls out, and clicking any move seeks to it. */}
        <div className="xp-cube-plan">
          {stageGroups.map((group, g) => (
            <div key={g} className={`xp-cube-plan-row${stage === group.stage && !solved ? ' is-active' : ''}`}>
              <span className="xp-cube-plan-stage">{group.stage}{group.caseLabel ? ` · ${group.caseLabel}` : ''}</span>
              <span className="xp-cube-plan-moves">
                {group.moves.map(({ move, index }) => (
                  <button
                    key={index}
                    type="button"
                    className={index < moveCount ? 'is-done' : index === moveCount ? 'is-now' : ''}
                    onClick={() => seekTo(index + 1)}
                    aria-label={`Go to move ${index + 1}: ${move.face}${move.prime ? ' prime' : ''}`}
                  >
                    {move.face}{move.prime ? '′' : ''}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="xp-cube-playback" aria-label="Cube playback controls">
          <button type="button" onClick={stepBackward} disabled={Boolean(reduceMotion) || moveCount === 0} aria-label="Previous move">←</button>
          <button type="button" className="xp-cube-playback-main" onClick={togglePlayback} disabled={Boolean(reduceMotion) || solved} aria-label={isPlaying ? 'Pause solve' : 'Play solve'}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={stepForward} disabled={Boolean(reduceMotion) || solved} aria-label="Next move">→</button>
        </div>
        <p className="xp-cube-readout">
          {/* the clock tracks the solve rather than the scroll, so it always
              reads 0.00 unsolved and the full time on the last quarter-turn */}
          <b>{clock.toFixed(2)}s</b>
          <span>{String(moveCount).padStart(2, '0')} / {planLength} moves</span>
          <span>{solved ? 'Solved' : stage ? `${stage}${stage === 'ZBLL' && caseLabel ? ` · ${caseLabel}` : ''}` : 'Ready'}</span>
        </p>
      </div>
    </section>
  );
}
