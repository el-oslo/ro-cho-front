export interface Vertex {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  weight?: number;
  directed: boolean;
}

export interface Graph {
  vertices: Vertex[];
  edges: Edge[];
  directed: boolean;
  weighted: boolean;
}

export function emptyGraph(): Graph {
  return { vertices: [], edges: [], directed: false, weighted: true };
}
