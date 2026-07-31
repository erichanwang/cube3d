export interface CubeMove {
  face: 'R' | 'L' | 'U' | 'D' | 'F' | 'B';
  prime?: boolean;
}

export interface ResearchFieldNodeConfig {
  label: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}
