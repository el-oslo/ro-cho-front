import { Graph } from './graph.models';

export type VertexState = 'unvisited' | 'frontier' | 'active' | 'visited' | 'path' | 'rejected';
export type EdgeState = 'default' | 'traversed' | 'path' | 'rejected';

export interface AlgorithmStep {
  stepIndex: number;
  description: string;
  vertexStates: Record<string, VertexState>;
  edgeStates: Record<string, EdgeState>;
  metadata: Record<string, unknown>;
}

export interface AlgorithmInput {
  key: string;
  label: string;
  type: 'vertex-select' | 'number' | 'boolean';
  required: boolean;
  default?: unknown;
}

export interface GraphPreset {
  name: string;
  description: string;
  graph: Graph;
  defaultParams?: Record<string, unknown>;
}

export interface AlgorithmDef {
  id: string;
  name: string;
  description: string;
  requiresWeights: boolean;
  requiresDirected: boolean | null;
  inputs: AlgorithmInput[];
  presets: GraphPreset[];
  validate(graph: Graph): string | null;
  run(graph: Graph, params: Record<string, unknown>): AlgorithmStep[];
}
