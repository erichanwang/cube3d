"""A real, from-any-scrambled-state solver for the 3x3x3 cube.

Strategy: rather than hand-deriving (and risking subtly wrong) insertion
algorithms for every case of the beginner's method, this solves the cube
piece-by-piece using a small incremental breadth-first search:

  * pieces are identified by *what colors they carry* (via Cube.piece_groups,
    which is purely geometric and independent of the current scramble), not
    by hand-written index tables.
  * to place the next piece, we do an iterative-deepening search over the
    quarter/half turns for the shortest sequence that (a) puts this piece
    home and (b) does not disturb any piece that was already correctly
    placed in an earlier step.
  * because the search is staged (cross -> first-layer corners -> middle
    layer -> last layer) the "already correct" set only grows, so each
    individual search is small and fast, while the overall result is a
    genuine solve of an arbitrary scramble (not just an undo of known
    moves).

Only n == 3 is supported; solving general NxN cubes is a much larger
reduction-method problem that's out of scope here.
"""

from cube_engine import Cube, FACES

ALL_MOVES = []
for _f in ['U', 'D', 'F', 'B', 'L', 'R']:
    ALL_MOVES += [_f, _f + "'", _f + '2']


def _slot_correct(cube, slots):
    return all(cube.faces[f][i][j] == f for f, i, j in slots)


def _groups_by_label(cube):
    by_label = {}
    for g in cube.piece_groups():
        label = frozenset(f for f, i, j in g)
        by_label[label] = g
    return by_label


def _bfs_place(cube, target_slots, protect_groups, max_depth, generators=ALL_MOVES):
    """Shortest move sequence placing target_slots correctly while keeping
    every already-solved group in protect_groups solved. Returns a list of
    moves, or None if nothing was found within max_depth. `cube` itself is
    left unmodified - the search runs on a scratch working copy.

    Implemented as iterative-deepening DFS (mutate the working copy in
    place, undo with the inverse move on backtrack) rather than BFS with a
    visited-state table: cloning the full board and hashing it on every
    node turned out to dominate runtime once searches needed depth 6+, and
    a transposition table isn't needed for correctness here - only for
    avoiding redundant work, which the same-face pruning below already
    does cheaply."""
    protect_already_solved = [g for g in protect_groups if _slot_correct(cube, g)]

    def goal(c):
        if not _slot_correct(c, target_slots):
            return False
        return all(_slot_correct(c, g) for g in protect_already_solved)

    if goal(cube):
        return []

    work = cube.copy()
    path = []

    def dfs(depth_remaining, last_face):
        for mv in generators:
            # Two consecutive turns of the same face always collapse into a
            # single turn (or cancel out), so they can never appear in a
            # shortest solution - skipping them prunes the branching factor
            # without excluding any optimal path.
            if mv[0] == last_face:
                continue
            work.apply_move(mv)
            path.append(mv)
            if goal(work):
                return True
            if depth_remaining > 1 and dfs(depth_remaining - 1, mv[0]):
                return True
            path.pop()
            work.apply_move(Cube.inverse_move(mv))
        return False

    for depth in range(1, max_depth + 1):
        if dfs(depth, ''):
            return list(path)
    return None


def _bfs_place_dedup(cube, target_slots, protect_groups, max_depth, generators):
    """Like _bfs_place, but a true breadth-first search deduplicated on the
    *watched* cells only (target_slots plus whichever protect_groups are
    currently solved), instead of plain IDDFS over the full board.

    Cells outside the watched set (e.g. the D layer, before it's that
    stage's turn) are free to end up however - we only ever check them
    later, with their own dedicated stage - so collapsing every full-board
    state that agrees on the watched cells into one is exactly the
    pruning we want, and unlike IDDFS it can still finish when the
    watched set is small even though the *full* board's branching factor
    would make this hopeless. (Whether that collapse actually keeps the
    frontier small depends on how many cells are watched - it isn't a
    universal fix, hence this exists alongside _bfs_place rather than
    replacing it.)"""
    protect_already_solved = [g for g in protect_groups if _slot_correct(cube, g)]
    watched = list(target_slots)
    for g in protect_already_solved:
        watched.extend(g)
    target_values = tuple(f for f, i, j in watched)

    def key(c):
        return tuple(c.faces[f][i][j] for f, i, j in watched)

    if key(cube) == target_values:
        return []

    seen = {key(cube)}
    frontier = [(cube.copy(), [])]
    for _depth in range(1, max_depth + 1):
        new_frontier = []
        for state, path in frontier:
            last_face = path[-1][0] if path else ''
            for mv in generators:
                if mv[0] == last_face:
                    continue
                nxt = state.copy()
                nxt.apply_move(mv)
                k = key(nxt)
                if k == target_values:
                    return path + [mv]
                if k in seen:
                    continue
                seen.add(k)
                new_frontier.append((nxt, path + [mv]))
        frontier = new_frontier
        if not frontier:
            break
    return None


def _solve_stage(cube, target_labels, all_labels, label_to_group, max_depth, log):
    moves = []
    for label in target_labels:
        group = label_to_group[label]
        if _slot_correct(cube, group):
            continue
        protect_groups = [label_to_group[l] for l in all_labels if l != label]
        found = _bfs_place(cube, group, protect_groups, max_depth)
        if found is None:
            raise RuntimeError(f"solver stuck trying to place {sorted(label)}")
        cube.apply_moves(found)
        moves.extend(found)
        if log:
            log(f"placed {''.join(sorted(label))}: {' '.join(found) if found else '(already solved)'}")
    return moves


# --- piece insertion via restricted-generator search ----------------------
#
# Once the U-cross is solved, each U-corner is reachable from the D layer
# using only its own two side faces plus D (the standard "keyhole" F2L
# corner setup, mirrored for a U-first/D-last convention), and the same is
# true of a middle-layer edge (its own two side faces plus D). Rather than
# hand-deriving which commutator/algorithm applies for each case - which
# turned out to vary unpredictably per scramble and was a recurring source
# of bugs - this just reuses the same generic BFS placement search used for
# the cross, restricted to the piece's own side face(s) plus D. Restricting
# the generator set keeps the search small and fast while every disturbance
# check (does this sequence clobber an already-placed piece?) is still done
# exactly, via _bfs_place's full-board goal check - so correctness doesn't
# depend on case analysis at all.
#
# D-layer pieces (the last stage) are different: by then they're the only
# things left unsolved, but fixing one can require a real last-layer-style
# algorithm that swaps it with an *adjacent* D slot via a side face that
# isn't its own (mirroring how OLL/PLL use every side face plus the one
# free layer) - so for those, all 4 side faces plus D are used instead of
# just the piece's own.
#
# Mid-layer edges have a further wrinkle: by the time this stage runs,
# every U corner is already placed, so there's no empty U slot left to
# maneuver through (no "keyhole") - unlike a normal F2L pairing, which
# always has a free corner slot to work with. For most scrambles the
# piece's own two side faces + D still happens to reach the goal within
# max_depth, but not always: some configurations provably need more
# than max_depth quarter turns from just those 3 faces (confirmed by
# exhaustive search), and widening to more faces blows up the per-node
# branching too much for plain IDDFS to finish in practice. The fallback
# below resolves this the same way the last layer does: a few short
# commutators, *discovered* (not hand-derived) by brute-force search and
# verified to never touch any U-layer sticker - i.e. pure relative to U,
# the mirror image of the last-layer commutators' purity relative to
# non-D - searched as atomic macro-moves (_MID_GENERATORS) instead of
# single quarter turns. Each one is "expensive" (8-10 real moves) but
# pure, so the high-level search over just a handful of them stays tiny
# regardless of how scrambled the D layer is meanwhile - it's cleaned up
# unconditionally by the last-layer stage afterward.
_MID_C1 = ['F', 'L', "F'", "D'", "F'", 'D', 'F', "L'"]
_MID_C2 = ['F', 'R', "D'", "R'", "F'", 'R', 'D', "R'"]
_MID_C3 = ['F2', 'D2', 'L2', 'D2', 'F2', 'D2', 'L2', 'D2']
_MID_C4 = ['F2', 'D2', 'L2', 'R2', 'D2', 'F2', 'D2', 'R2', 'L2', 'D2']

_MID_GENERATORS = {
    'D': ['D'], "D'": ["D'"], 'D2': ['D2'],
    'C1': _MID_C1, 'C1i': Cube.inverse_sequence(_MID_C1),
    'C2': _MID_C2, 'C2i': Cube.inverse_sequence(_MID_C2),
    'C3': _MID_C3, 'C3i': Cube.inverse_sequence(_MID_C3),
    'C4': _MID_C4, 'C4i': Cube.inverse_sequence(_MID_C4),
}
_MID_INVERSE_GEN = {
    'D': "D'", "D'": 'D', 'D2': 'D2',
    'C1': 'C1i', 'C1i': 'C1',
    'C2': 'C2i', 'C2i': 'C2',
    'C3': 'C3i', 'C3i': 'C3',
    'C4': 'C4i', 'C4i': 'C4',
}


def _bfs_place_macro(cube, target_slots, protect_groups, max_depth, macro_generators, inverse_gen):
    """Like _bfs_place, but each named generator in `macro_generators` is a
    whole move sequence applied/undone as a single search step, for cases
    where the needed depth in raw quarter turns is too large for plain
    IDDFS to explore directly."""
    protect_already_solved = [g for g in protect_groups if _slot_correct(cube, g)]

    def goal(c):
        if not _slot_correct(c, target_slots):
            return False
        return all(_slot_correct(c, g) for g in protect_already_solved)

    if goal(cube):
        return []

    work = cube.copy()
    path = []
    names = list(macro_generators.keys())

    def dfs(depth_remaining, last_name):
        for name in names:
            if last_name is not None and name == inverse_gen[last_name]:
                continue
            seq = macro_generators[name]
            work.apply_moves(seq)
            path.append(name)
            if goal(work):
                return True
            if depth_remaining > 1 and dfs(depth_remaining - 1, name):
                return True
            path.pop()
            work.apply_moves(Cube.inverse_sequence(seq))
        return False

    for depth in range(1, max_depth + 1):
        if dfs(depth, None):
            moves = []
            for name in path:
                moves += macro_generators[name]
            return moves
    return None


def _insert_piece(cube, label, protect_groups, max_depth=9):
    home_group = _groups_by_label(cube)[label]
    if _slot_correct(cube, home_group):
        return []

    if 'D' in label:
        side_faces = ['B', 'F', 'L', 'R']
    else:
        side_faces = sorted(f for f in label if f not in ('U', 'D'))
    generators = []
    for f in side_faces + ['D']:
        generators += [f, f + "'", f + '2']

    protect = [g for g in protect_groups if g != home_group]
    is_mid_edge = 'D' not in label and 'U' not in label
    is_u_corner = 'U' in label
    # Restricting the primary search to the piece's own faces + D can run
    # into the same "no empty keyhole slot left" problem for both
    # U-corners (once enough of the other 3 are already placed) and
    # mid-layer edges (always, since every U corner is placed by then) -
    # in which case depth 8-9 here can take minutes to exhaust before
    # concluding nothing exists. Cap the primary attempt shallower and
    # fall through to broader searches instead of paying that cost.
    primary_depth = 7 if (is_mid_edge or is_u_corner) else max_depth
    found = _bfs_place(cube, home_group, protect, primary_depth, generators=generators)
    if found is None and is_u_corner:
        # All 4 side faces + D, deduplicated on the watched cells (target
        # + whatever's already correctly placed) rather than the full
        # board - at this stage few enough cells are watched that this
        # stays fast (unlike the always-fully-protected mid-edge case
        # below, where it doesn't help - see _bfs_place_dedup's docstring).
        all4_gens = []
        for f in ['B', 'F', 'L', 'R', 'D']:
            all4_gens += [f, f + "'", f + '2']
        found = _bfs_place_dedup(cube, home_group, protect, 9, all4_gens)
    if found is None and is_mid_edge:
        found = _bfs_place_macro(cube, home_group, protect, 6, _MID_GENERATORS, _MID_INVERSE_GEN)
    if found is None:
        raise RuntimeError(f"failed to insert piece {sorted(label)}")
    cube.apply_moves(found)
    return found


# --- last layer: solved via a closed pure-commutator lookup table ----------
#
# Piece-by-piece insertion (as used for the earlier stages) breaks down for
# the last layer: with U and the middle layer already fixed, the relaxed
# "place this piece without disturbing anything already correct" goal can
# require a real OLL/PLL-style algorithm 10-15 moves long. Worse, F/B/L/R/D
# (the only moves available once U is permanently solved) generate the
# *entire* cube group, not just a small last-layer subgroup - any two
# adjacent face turns already generate the whole ~4.3*10^19-element group,
# so a plain depth-12+ brute-force search for the literal solved state is
# as hard as general optimal cube solving, and pattern-database heuristics
# built from small piece subsets (tried first) turned out far too weak to
# guide either IDA* or greedy best-first search to convergence in practice.
#
# Real speedcubers solve this stage without any search at all: a small
# fixed library of named algorithms ("OLL"/"PLL"), each of which only ever
# touches the last layer, applied with simple setup turns to aim them at
# whichever pieces are actually out of place. The sequences below are this
# project's equivalent, but rather than hand-transcribing standard
# OLL/PLL algorithms (which are written for a specific move-direction
# convention and silently give the wrong result if that convention doesn't
# match this engine's - confirmed by trying exactly that and getting
# garbage), they were *discovered* by exhaustively trying short commutators
# A B A' B' against this engine directly and keeping the ones that verify
# as touching only the D layer:
#   _LL_C3 - a pure 3-cycle of three D corners (found directly).
#   _LL_E3 - a pure 3-cycle of three D edges, built by taking a commutator
#     that happened to 3-cycle corners *and* edges together and cancelling
#     its corner part with a D-conjugated _LL_C3 that provably has the same
#     corner cycle (verified by direct comparison), leaving only the edge
#     cycle.
#   _LL_Y - a pure simultaneous 2-corner-twist + 2-edge-flip, built the same
#     cancellation way from a commutator whose corner-permutation part
#     matched _LL_C3's inverse.
# Together with D/D'/D2 (which trivially only touch the D layer) these
# generate the *entire* group of legal last-layer-only transformations
# (verified by BFS dedup on the D-layer's 21 stickers: exactly 62208
# distinct reachable states, matching 24 corner perms * 24 edge perms
# restricted to matching parity * 27 valid corner-orientation sums * 8
# valid edge-orientation sums). Because that BFS is exhaustive and small,
# it's run once (cached at module level) to build a shortest-path table
# keyed by the D-layer's own state, and every later solve is then an O(1)
# table lookup followed by replaying (the inverses of) the recorded moves -
# no per-scramble search at all.
_LL_C3 = ['F', 'L', 'B', "L'", "F'", 'L', "B'", "L'"]
_LL_CE = ['D', 'F', 'L', "D'", "L'", "D'", 'L', 'D', "L'", "F'"]
_LL_E3 = _LL_CE + ["D'"] + Cube.inverse_sequence(_LL_C3) + ['D']
_LL_X = ['F', 'L', 'L', "B'", "L'", "L'", "F'", 'L', 'B', "L'"]
_LL_Y = _LL_X + _LL_C3 + Cube.inverse_sequence(_LL_E3)

_LL_GENERATORS = {
    'D': ['D'], "D'": ["D'"], 'D2': ['D2'],
    'C3': _LL_C3, 'C3i': Cube.inverse_sequence(_LL_C3),
    'E3': _LL_E3, 'E3i': Cube.inverse_sequence(_LL_E3),
    'Y': _LL_Y, 'Yi': Cube.inverse_sequence(_LL_Y),
}
_LL_INVERSE_GEN = {
    'D': "D'", "D'": 'D', 'D2': 'D2',
    'C3': 'C3i', 'C3i': 'C3',
    'E3': 'E3i', 'E3i': 'E3',
    'Y': 'Yi', 'Yi': 'Y',
}

_ll_cache = {}


def _full_state_key(cube):
    return tuple(v for f in FACES for row in cube.faces[f] for v in row)


def _load_state_key(cube, key):
    n = cube.n
    idx = 0
    for f in FACES:
        for i in range(n):
            for j in range(n):
                cube.faces[f][i][j] = key[idx]
                idx += 1


def _last_layer_d_groups():
    return [g for g in Cube(3).piece_groups() if any(f == 'D' for f, i, j in g)]


def _last_layer_d_key(cube, d_groups):
    return tuple(cube.faces[f][i][j] for g in d_groups for f, i, j in g)


def _build_last_layer_table():
    """Exhaustive BFS from solved over _LL_GENERATORS, deduplicated on the
    D-layer's own 21 stickers (since every generator is pure, this key is
    exactly as much state as is needed - nothing outside the D layer can
    ever differ from solved). table[key] is None for the solved key itself,
    or (prev_key, generator_name) recording that `key` was first reached by
    applying that generator to a cube in state `prev_key`."""
    d_groups = _last_layer_d_groups()
    solved = Cube(3)
    start_d = _last_layer_d_key(solved, d_groups)
    table = {start_d: None}
    frontier = [_full_state_key(solved)]
    scratch = Cube(3)
    while frontier:
        new_frontier = []
        for fk in frontier:
            _load_state_key(scratch, fk)
            cur_d = _last_layer_d_key(scratch, d_groups)
            for name, seq in _LL_GENERATORS.items():
                for mv in seq:
                    scratch.apply_move(mv)
                new_d = _last_layer_d_key(scratch, d_groups)
                if new_d not in table:
                    table[new_d] = (cur_d, name)
                    new_frontier.append(_full_state_key(scratch))
                for mv in reversed(seq):
                    scratch.apply_move(Cube.inverse_move(mv))
        frontier = new_frontier
    return table, d_groups


def _last_layer_table():
    if not _ll_cache:
        table, d_groups = _build_last_layer_table()
        _ll_cache['table'] = table
        _ll_cache['d_groups'] = d_groups
    return _ll_cache


def _solve_last_layer(cube, log=None):
    if cube.is_solved():
        if log:
            log("solved last layer: (already solved)")
        return []

    info = _last_layer_table()
    table, d_groups = info['table'], info['d_groups']
    key = _last_layer_d_key(cube, d_groups)
    if key not in table:
        raise RuntimeError("last layer state missing from lookup table (bug)")

    path = []
    while table[key] is not None:
        prev_key, name = table[key]
        path += _LL_GENERATORS[_LL_INVERSE_GEN[name]]
        key = prev_key

    cube.apply_moves(path)
    if not cube.is_solved():
        raise RuntimeError("failed to solve last layer (bug)")
    if log:
        log(f"solved last layer: {' '.join(path) if path else '(already solved)'}")
    return path


def solve(cube, log=None):
    """Return a list of moves that solves `cube` (a 3x3 Cube). The cube's
    own state is left solved as a side effect (moves are applied as found)."""
    if cube.n != 3:
        raise ValueError("solve() only supports 3x3x3 cubes")

    labels = _groups_by_label(cube)
    edge_labels = [l for l in labels if len(labels[l]) == 2]
    corner_labels = [l for l in labels if len(labels[l]) == 3]

    u_cross = [l for l in edge_labels if 'U' in l]
    u_corners = [l for l in corner_labels if 'U' in l]
    mid_edges = [l for l in edge_labels if 'D' not in l and 'U' not in l]

    all_moves = []
    # Groups belonging to stages completed (or in progress) so far. Only
    # these get passed as protect_groups - a not-yet-attempted D-layer
    # piece that happens to already sit correctly *by chance* must not be
    # protected this early, or it over-constrains earlier-stage searches
    # for no benefit (it's fair game until its own stage comes up).
    protected = []

    all_moves += _solve_stage(cube, u_cross, u_cross, labels, max_depth=10, log=log)
    protected += [labels[l] for l in u_cross]

    for stage in (u_corners, mid_edges):
        stage_groups = [labels[l] for l in stage]
        for label in stage:
            found = _insert_piece(cube, label, protected + stage_groups)
            all_moves.extend(found)
            if log:
                log(f"placed {''.join(sorted(label))}: {' '.join(found) if found else '(already solved)'}")
        protected += stage_groups

    all_moves += _solve_last_layer(cube, log=log)

    if not cube.is_solved():
        raise RuntimeError("solver finished but cube is not solved (bug)")
    return all_moves


def scramble(cube, n_moves=25, rng=None):
    import random
    r = rng or random
    moves_pool = []
    for f in ['U', 'D', 'F', 'B', 'L', 'R']:
        moves_pool += [f, f + "'", f + '2']
    seq = [r.choice(moves_pool) for _ in range(n_moves)]
    cube.apply_moves(seq)
    return seq
