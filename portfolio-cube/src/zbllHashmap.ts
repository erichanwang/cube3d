import { ZBLS_TABLE } from './cubeTables.ts';
import { ZBLL_TABLE, type ZBLLCase } from './zbllTable.ts';

/**
 * Nested ZBLL index:
 *
 *   ZBLS case key -> yellow-piece pattern -> ZBLL case key -> algorithm/label
 *
 * The ZBLS key is the state handed to the last-slot ZBLS look. The yellow
 * pattern is the four last-layer corner orientations after ZBLS, encoded with
 * the same `co` digits used by `llTwistKey`. The final key is the complete
 * canonical ZBLL state (`yellow pattern | corner permutation | edge
 * permutation`).
 *
 * ZBLS keys intentionally do not encode last-layer permutation, so every ZBLS
 * case can lead to every legal ZBLL state. The inner ZBLL table is therefore
 * shared by reference instead of duplicated 1,200 times.
 */
export type ZBLLCaseMap = Record<string, ZBLLCase>;
export type ZBLLHashmap = Record<string, Record<string, ZBLLCaseMap>>;

export const ZBLL_YELLOW_PATTERNS = [...new Set(
  Object.keys(ZBLL_TABLE).map((key) => key.split('|', 1)[0]!),
)];

/** Keep only the ZBLL states whose first key segment is this yellow pattern. */
const casesByYellowPattern = Object.fromEntries(
  ZBLL_YELLOW_PATTERNS.map((pattern) => [
    pattern,
    Object.fromEntries(
      Object.entries(ZBLL_TABLE).filter(([key]) => key.startsWith(`${pattern}|`)),
    ) as ZBLLCaseMap,
  ]),
) as Record<string, ZBLLCaseMap>;

/**
 * The complete nested index. The innermost maps are shared because ZBLS keys
 * describe the pre-ZBLS last-slot state, while the 1,944 ZBLL states describe
 * the post-ZBLS last-layer state; those dimensions are independent.
 */
export const ZBLL_HASHMAP = Object.fromEntries(
  Object.keys(ZBLS_TABLE).map((zblsCase) => [zblsCase, casesByYellowPattern]),
) as ZBLLHashmap;

export const ZBLL_HASHMAP_COUNTS = {
  zblsCases: Object.keys(ZBLL_HASHMAP).length,
  yellowPatterns: ZBLL_YELLOW_PATTERNS.length,
  zbllCases: Object.keys(ZBLL_TABLE).length,
};

export function lookupZBLLCase(
  zblsCase: string,
  yellowPattern: string,
  zbllCase: string,
): ZBLLCase | undefined {
  return ZBLL_HASHMAP[zblsCase]?.[yellowPattern]?.[zbllCase];
}
