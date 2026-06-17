"""Geometrically-correct NxN Rubik's cube model.

Earlier versions of this project modeled face turns by hand-typing index
cycling formulas per face (see git history of rcube3d.py / rcube3.py). Those
formulas disagreed with each other between the two implementations and were
easy to get subtly wrong (off-by-one row/column, wrong reversal direction).

This module instead represents every sticker by the 3D position of its
center on the cube's surface (the same coordinate convention the 3D renderer
already uses) and performs a move by literally rotating the affected
stickers' 3D positions by 90 degrees about the relevant axis, then snapping
each rotated position back onto the nearest sticker slot. Because a 90
degree rotation about a face-aligned axis maps the sticker-center grid
exactly onto itself, this is correct by construction for any cube size,
including slice moves (M/E/S) and is not dependent on hand-derived index
math.
"""

import itertools

FACES = ('U', 'D', 'F', 'B', 'L', 'R')

# face -> (center, right_vec, up_vec) using the same convention as the
# renderer's accumulate_all_polygons().
_FACE_AXES = {
    'F': ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    'B': ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
    'U': ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    'D': ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    'L': ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    'R': ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
}

_ROUND = 6


def _cell_center(face, i, j, n):
    cs = 2.0 / n
    local_x = -1 + (j + 0.5) * cs
    local_y = 1 - (i + 0.5) * cs
    center, right_vec, up_vec = _FACE_AXES[face]
    x = center[0] + local_x * right_vec[0] + local_y * up_vec[0]
    y = center[1] + local_x * right_vec[1] + local_y * up_vec[1]
    z = center[2] + local_x * right_vec[2] + local_y * up_vec[2]
    return (round(x, _ROUND), round(y, _ROUND), round(z, _ROUND))


def _rotate90(axis, sign, pos):
    """Rotate pos by 90 degrees about axis.

    sign=+1: clockwise viewed from the positive end of the axis looking
    toward the origin. sign=-1: clockwise viewed from the negative end.
    """
    x, y, z = pos
    if axis == 'x':
        if sign == 1:
            y, z = z, -y
        else:
            y, z = -z, y
    elif axis == 'y':
        if sign == 1:
            z, x = x, -z
        else:
            z, x = -x, z
    else:  # 'z'
        if sign == 1:
            x, y = y, -x
        else:
            x, y = -y, x
    return (round(x, _ROUND), round(y, _ROUND), round(z, _ROUND))


# move name -> (axis, sign, layer_select)
# layer_select(coord, n, depth) -> True if a sticker whose coordinate along
# `axis` equals `coord` belongs to this move's slice. depth = number of
# outer layers turned (for wide moves on big cubes); depth=None means the
# single middle slice (only valid for odd n).
def _outer_layer(sign_side):
    def select(coord, n, depth):
        threshold = 1 - (2.0 / n) * depth + 1e-6
        if sign_side > 0:
            return coord > threshold
        return coord < -threshold
    return select


def _middle_layer():
    def select(coord, n, depth):
        if n % 2 == 0:
            raise ValueError("middle slice move requires odd cube size")
        return abs(coord) < (1.0 / n)
    return select


_MOVES = {
    'R': ('x', 1, _outer_layer(1)),
    'L': ('x', -1, _outer_layer(-1)),
    'U': ('y', 1, _outer_layer(1)),
    'D': ('y', -1, _outer_layer(-1)),
    'F': ('z', 1, _outer_layer(1)),
    'B': ('z', -1, _outer_layer(-1)),
    'M': ('x', -1, _middle_layer()),  # turns like L
    'E': ('y', -1, _middle_layer()),  # turns like D
    'S': ('z', 1, _middle_layer()),   # turns like F
}

_AXIS_INDEX = {'x': 0, 'y': 1, 'z': 2}

# (n, base_move, depth) -> {src_slot: dst_slot} for a single quarter turn.
# Shared across all Cube instances of a given size since it's pure geometry.
_QUARTER_MAP_CACHE = {}

# (n, base_move, depth, times) -> [(src_slot, dst_slot), ...] for the
# *whole* move (times=1/2/3 quarter turns composed into one mapping), so a
# prime or double move costs exactly one read/write pass instead of
# three/two.
_MOVE_MAP_CACHE = {}

# move token string (e.g. "Rw2") -> (base, depth, times), so repeated
# moves of the same token (the overwhelming majority during search) skip
# the string-parsing every apply_move call.
_TOKEN_INFO_CACHE = {}


class Cube:
    def __init__(self, n=3):
        self.n = n
        self.faces = {f: [[f for _ in range(n)] for _ in range(n)] for f in FACES}
        self._build_geometry()
        self.move_log = []

    def _build_geometry(self):
        n = self.n
        # position -> (face, i, j) and the reverse, for every sticker slot.
        self._pos_to_slot = {}
        self._slot_to_pos = {}
        for face in FACES:
            for i in range(n):
                for j in range(n):
                    pos = _cell_center(face, i, j, n)
                    self._pos_to_slot[pos] = (face, i, j)
                    self._slot_to_pos[(face, i, j)] = pos

    def copy(self):
        c = Cube.__new__(Cube)
        c.n = self.n
        c.faces = {f: [row[:] for row in self.faces[f]] for f in FACES}
        c._pos_to_slot = self._pos_to_slot
        c._slot_to_pos = self._slot_to_pos
        c.move_log = list(self.move_log)
        return c

    def _quarter_turn_map(self, base, depth):
        # The mapping of which (face,i,j) slot a quarter turn sends every
        # affected slot to depends only on cube size, not on the current
        # sticker colors, so it's computed once per (n, base, depth) and
        # reused for every future move.
        key = (self.n, base, depth)
        mapping = _QUARTER_MAP_CACHE.get(key)
        if mapping is None:
            n = self.n
            axis, sign, select_fn = _MOVES[base]
            ai = _AXIS_INDEX[axis]
            mapping = {}
            for face in FACES:
                for i in range(n):
                    for j in range(n):
                        pos = self._slot_to_pos[(face, i, j)]
                        if not select_fn(pos[ai], n, depth):
                            continue
                        new_pos = _rotate90(axis, sign, pos)
                        mapping[(face, i, j)] = self._pos_to_slot[new_pos]
            _QUARTER_MAP_CACHE[key] = mapping
        return mapping

    def _move_pairs(self, base, depth, times):
        # Composes `times` quarter turns into a single list of (src, dst)
        # slot pairs, so a prime (3 quarter turns) or double (2) move costs
        # one read/write pass instead of three/two. times=3 (prime) is just
        # the inverse of a single quarter turn (rotating -90 == rotating
        # +90 three times). Stored as a list, not a dict, since it's
        # iterated (never looked up by key) on every move application.
        key = (self.n, base, depth, times)
        pairs = _MOVE_MAP_CACHE.get(key)
        if pairs is None:
            quarter = self._quarter_turn_map(base, depth)
            if times == 1:
                pairs = list(quarter.items())
            elif times == 2:
                pairs = [(src, quarter[dst]) for src, dst in quarter.items()]
            else:
                pairs = [(dst, src) for src, dst in quarter.items()]
            _MOVE_MAP_CACHE[key] = pairs
        return pairs

    def apply_move(self, move):
        """Apply a single move token, e.g. 'R', "R'", 'R2', 'Rw', "Rw'", 'Rw2'."""
        info = _TOKEN_INFO_CACHE.get(move)
        if info is None:
            token = move
            prime = token.endswith("'")
            double = token.endswith('2')
            core = token[:-1] if (prime or double) else token
            wide = core.endswith('w')
            base = core[:-1] if wide else core
            if base not in _MOVES:
                raise ValueError(f"unknown move {move!r}")
            info = (base, 2 if wide else 1, 2 if double else (3 if prime else 1))
            _TOKEN_INFO_CACHE[move] = info
        base, depth, times = info
        pairs = self._move_pairs(base, depth, times)
        faces = self.faces
        # Read every source value before writing any destination: pairs
        # form a set of rotation cycles over the affected slots, so writing
        # first could clobber a value another pair still needs to read.
        values = [faces[s[0]][s[1]][s[2]] for s, _d in pairs]
        for (_s, d), val in zip(pairs, values):
            faces[d[0]][d[1]][d[2]] = val
        self.move_log.append(move)

    def apply_moves(self, moves):
        for m in moves:
            self.apply_move(m)

    @staticmethod
    def inverse_move(move):
        if move.endswith('2'):
            return move
        if move.endswith("'"):
            return move[:-1]
        return move + "'"

    @staticmethod
    def inverse_sequence(moves):
        return [Cube.inverse_move(m) for m in reversed(moves)]

    def is_solved(self):
        return all(all(c == face for row in self.faces[face] for c in row) for face in FACES)

    def print_cube(self, move=""):
        if move:
            print(f"\nPerformed move: {move}")
        else:
            print("\nCube state:")
        for face in FACES:
            print(f"{face} face:")
            for row in self.faces[face]:
                print("  " + " ".join(row))
        print("-" * 30)

    # --- piece grouping (used by the solver) -----------------------------
    def piece_groups(self):
        """Group sticker slots that belong to the same physical cubie.

        Returns a list of tuples of (face, i, j) slots; len 1 = center,
        len 2 = edge, len 3 = corner (for a 3x3; bigger cubes also produce
        wing/edge pieces of length 2 and pure centers of length 1).
        """
        n = self.n
        cs = 2.0 / n
        buckets = {}
        for (face, i, j), pos in self._slot_to_pos.items():
            # snap each coordinate to a cubie-layer index 0..n-1
            key = []
            for c in pos:
                idx = round((c + 1 - cs / 2) / cs)
                idx = max(0, min(n - 1, idx))
                key.append(idx)
            buckets.setdefault(tuple(key), []).append((face, i, j))
        return list(buckets.values())
