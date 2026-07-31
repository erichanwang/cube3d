export type MoveFace =
  | 'R' | 'L' | 'U' | 'D' | 'F' | 'B'
  | 'M' | 'E' | 'S'
  | 'r' | 'l' | 'u' | 'd' | 'f' | 'b'
  | 'x' | 'y' | 'z';

export interface CubeMove {
  face: MoveFace;
  prime?: boolean;
  /** Half turn when present; omitted means one quarter turn. */
  turns?: 1 | 2;
}

export interface ResearchFieldNodeConfig {
  label: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}
