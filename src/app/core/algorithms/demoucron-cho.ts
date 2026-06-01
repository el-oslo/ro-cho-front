/**
 * Demoucron — Chemin Optimal (Optimal Path)
 *
 * Floyd-Warshall style iterative matrix relaxation for directed weighted graphs.
 * Supports both min (shortest) and max (longest) path objectives.
 *
 * Correctness note vs. React reference: reconstructPath here correctly handles
 * direct edges (prev[i][j] === null but V[i][j] !== EMPTY) by returning [i, j]
 * instead of null. The React version omits this case and silently produces no path
 * for pairs connected only by a direct arc with no intermediate improvement.
 */

import { Graph } from '../models/graph.models';
import { AlgorithmStep, AlgorithmDef, VertexState, EdgeState } from '../models/algorithm.models';

const INF  =  Infinity;
const NINF = -Infinity;

type Matrix     = number[][];
type PrevMatrix = (number | null)[][];

interface ChoMeta {
  matrixSnapshot:      (number | string)[][];
  vertexLabels:        string[];
  currentIntermediate: string | null;
  currentI:            number | null;
  currentJ:            number | null;
  wValue:              number | null;
  improved:            boolean;
  optimalPath:         string[];
  optimalValue:        number | null;
  mode:                'min' | 'max';
  phase:               'init' | 'relaxation' | 'reconstruction' | 'done';
}

function displayVal(v: number, mode: 'min' | 'max'): string {
  if (v === INF)  return '+∞';
  if (v === NINF) return '-∞';
  return String(v);
}

function snapshot(m: Matrix, mode: 'min' | 'max'): (number | string)[][] {
  return m.map(row => row.map(v => (v === INF || v === NINF) ? displayVal(v, mode) : v));
}

function clone(m: Matrix): Matrix {
  return m.map(row => [...row]);
}

/**
 * Reconstructs the optimal path between src and tgt using the prev matrix.
 *
 * Bug fix: when prev[src][tgt] === null it means the value was set directly
 * from an edge in the initialisation phase (no intermediate ever improved it).
 * We check V[src][tgt] !== EMPTY to distinguish a direct edge from no path.
 */
function reconstructPath(
  prev: PrevMatrix,
  V: Matrix,
  EMPTY: number,
  src: number,
  tgt: number
): number[] | null {
  if (src === tgt) return [src];

  const k = prev[src][tgt];
  if (k === null) {
    // Direct edge (set during init, never improved via intermediate) vs. no path
    return V[src][tgt] !== EMPTY ? [src, tgt] : null;
  }

  const left  = reconstructPath(prev, V, EMPTY, src, k);
  const right = reconstructPath(prev, V, EMPTY, k, tgt);
  if (!left || !right) return null;
  return [...left, ...right.slice(1)];
}

export function runDemoucronCho(graph: Graph, params: Record<string, unknown>): AlgorithmStep[] {
  const steps: AlgorithmStep[] = [];
  const vertices = graph.vertices;
  const n = vertices.length;
  if (n === 0) return steps;

  const maximize  = !!(params['mode'] as boolean | undefined);
  const mode: 'min' | 'max' = maximize ? 'max' : 'min';
  const sourceId  = params['source'] as string | undefined;
  const targetId  = params['target'] as string | undefined;

  const EMPTY      = mode === 'min' ? INF : NINF;
  const betterThan = mode === 'min'
    ? (a: number, b: number) => a < b
    : (a: number, b: number) => a > b;

  const idToIdx = new Map(vertices.map((v, i) => [v.id, i]));
  const labels  = vertices.map(v => v.label);

  const srcIdx = sourceId ? (idToIdx.get(sourceId) ?? null) : null;
  const tgtIdx = targetId ? (idToIdx.get(targetId) ?? null) : null;

  // ── Build initial matrix D¹ ──────────────────────────────────────────────
  const V: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : EMPTY))
  );
  const prev: PrevMatrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => null)
  );

  for (const edge of graph.edges) {
    const i = idToIdx.get(edge.source);
    const j = idToIdx.get(edge.target);
    if (i === undefined || j === undefined) continue;
    const w = edge.weight ?? 1;
    if (betterThan(w, V[i][j])) V[i][j] = w;
    if (!graph.directed && betterThan(w, V[j][i])) V[j][i] = w;
  }

  // Helper: build vertex/edge states for a step
  function buildStates(
    hI: number | null,
    hJ: number | null,
    hK: number | null,
    pathIdx: number[]
  ): { vertexStates: Record<string, VertexState>; edgeStates: Record<string, EdgeState> } {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates:   Record<string, EdgeState>   = {};
    const pathSet = new Set(pathIdx);
    const pathEdges = new Set<string>();
    for (let p = 0; p < pathIdx.length - 1; p++) {
      const a = vertices[pathIdx[p]].id;
      const b = vertices[pathIdx[p + 1]].id;
      pathEdges.add(`${a}->${b}`);
      if (!graph.directed) pathEdges.add(`${b}->${a}`);
    }
    for (let i = 0; i < n; i++) {
      const id = vertices[i].id;
      if (pathSet.size && pathSet.has(i)) vertexStates[id] = 'path';
      else if (i === hK)                  vertexStates[id] = 'active';
      else if (i === hI || i === hJ)      vertexStates[id] = 'frontier';
      else                                vertexStates[id] = 'unvisited';
    }
    for (const edge of graph.edges) {
      edgeStates[edge.id] = pathEdges.has(`${edge.source}->${edge.target}`) ? 'path' : 'default';
    }
    return { vertexStates, edgeStates };
  }

  function makeMeta(
    hI: number | null, hJ: number | null, hK: number | null,
    wValue: number | null, improved: boolean,
    optimalPath: string[], optimalValue: number | null,
    phase: ChoMeta['phase']
  ): ChoMeta {
    return {
      matrixSnapshot: snapshot(clone(V), mode),
      vertexLabels:   labels,
      currentIntermediate: hK !== null ? labels[hK] : null,
      currentI:   hI,
      currentJ:   hJ,
      wValue,
      improved,
      optimalPath,
      optimalValue,
      mode,
      phase,
    };
  }

  let idx = 0;

  // ── Init step ────────────────────────────────────────────────────────────
  {
    const { vertexStates, edgeStates } = buildStates(null, null, null, []);
    steps.push({
      stepIndex: idx++,
      description: `Init: build matrix D¹ from direct edges (∞ = no direct link).`,
      vertexStates, edgeStates,
      metadata: makeMeta(null, null, null, null, false, [], null, 'init') as unknown as Record<string, unknown>,
    });
  }

  // ── Relaxation passes k = 0 … n-1 ────────────────────────────────────────
  for (let k = 0; k < n; k++) {
    const kLabel = labels[k];

    {
      const { vertexStates, edgeStates } = buildStates(null, null, k, []);
      steps.push({
        stepIndex: idx++,
        description: `Step k=${k + 1}: allow intermediate vertex "${kLabel}". Compute W[i][j] = V[i][${kLabel}] + V[${kLabel}][j].`,
        vertexStates, edgeStates,
        metadata: makeMeta(null, null, k, null, false, [], null, 'relaxation') as unknown as Record<string, unknown>,
      });
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (V[i][k] === EMPTY || V[k][j] === EMPTY) continue;

        const wij = V[i][k] + V[k][j];
        const improved = betterThan(wij, V[i][j]);

        if (improved) {
          V[i][j]    = wij;
          prev[i][j] = k;
        }

        const { vertexStates, edgeStates } = buildStates(i, j, k, []);
        const oldDisplay = improved
          ? `replaced`
          : `kept (current: ${displayVal(V[i][j], mode)})`;
        steps.push({
          stepIndex: idx++,
          description: improved
            ? `W[${labels[i]}][${labels[j]}] = ${V[i][k]} + ${V[k][j]} = ${wij} → improved (${oldDisplay}).`
            : `W[${labels[i]}][${labels[j]}] = ${wij} — no improvement (${oldDisplay}).`,
          vertexStates, edgeStates,
          metadata: makeMeta(i, j, k, wij, improved, [], null, 'relaxation') as unknown as Record<string, unknown>,
        });
      }
    }

    {
      const { vertexStates, edgeStates } = buildStates(null, null, null, []);
      steps.push({
        stepIndex: idx++,
        description: `Matrix D${k + 1} complete after allowing "${kLabel}".`,
        vertexStates, edgeStates,
        metadata: makeMeta(null, null, null, null, false, [], null, 'relaxation') as unknown as Record<string, unknown>,
      });
    }
  }

  // ── Path reconstruction ───────────────────────────────────────────────────
  let optimalPath: string[] = [];
  let optimalValue: number | null = null;
  let pathIdx: number[] = [];

  if (srcIdx !== null && tgtIdx !== null) {
    optimalValue = V[srcIdx][tgtIdx];

    if (optimalValue === EMPTY) {
      const { vertexStates, edgeStates } = buildStates(null, null, null, []);
      steps.push({
        stepIndex: idx++,
        description: `Reconstruction: no ${mode} path exists from "${labels[srcIdx]}" to "${labels[tgtIdx]}".`,
        vertexStates, edgeStates,
        metadata: makeMeta(srcIdx, tgtIdx, null, null, false, [], null, 'reconstruction') as unknown as Record<string, unknown>,
      });
    } else {
      const raw = reconstructPath(prev, V, EMPTY, srcIdx, tgtIdx);
      if (raw) {
        pathIdx     = raw;
        optimalPath = raw.map(i => labels[i]);
        const { vertexStates, edgeStates } = buildStates(null, null, null, pathIdx);
        steps.push({
          stepIndex: idx++,
          description: `Reconstruction: ${mode === 'min' ? 'shortest' : 'longest'} path "${labels[srcIdx]}" → "${labels[tgtIdx]}": ${optimalPath.join(' → ')} (total: ${optimalValue}).`,
          vertexStates, edgeStates,
          metadata: makeMeta(srcIdx, tgtIdx, null, null, false, optimalPath, optimalValue, 'reconstruction') as unknown as Record<string, unknown>,
        });
      }
    }
  }

  // ── Final step ────────────────────────────────────────────────────────────
  {
    const { vertexStates, edgeStates } = buildStates(null, null, null, pathIdx);
    const desc = srcIdx !== null && tgtIdx !== null
      ? optimalPath.length
        ? `Done. ${mode === 'min' ? 'Shortest' : 'Longest'} path: ${optimalPath.join(' → ')} = ${optimalValue}.`
        : `Done. No path from "${labels[srcIdx ?? 0]}" to "${labels[tgtIdx ?? 0]}".`
      : `Done. Optimal path matrix computed for all vertex pairs.`;

    steps.push({
      stepIndex: idx++,
      description: desc,
      vertexStates, edgeStates,
      metadata: makeMeta(srcIdx, tgtIdx, null, null, false, optimalPath, optimalValue, 'done') as unknown as Record<string, unknown>,
    });
  }

  return steps;
}

export const demoucronChoDef: AlgorithmDef = {
  id: 'demoucron-cho',
  name: 'Demoucron — Optimal Path',
  description:
    'Matrix relaxation method (Floyd-Warshall style) computing optimal paths ' +
    'between all vertex pairs in a directed weighted graph. ' +
    'At each step k, vertex xₖ becomes an allowed intermediate: ' +
    'V[i][j] = min/max(V[i][j], V[i][k] + V[k][j]).',
  requiresWeights:  true,
  requiresDirected: true,
  inputs: [
    {
      key:      'mode',
      label:    'Maximize path (longest)',
      type:     'boolean',
      required: true,
      default:  false,
    },
    {
      key:      'source',
      label:    'Source vertex (optional)',
      type:     'vertex-select',
      required: false,
    },
    {
      key:      'target',
      label:    'Target vertex (optional)',
      type:     'vertex-select',
      required: false,
    },
  ],
  presets: [
    {
      name: 'Transport Network (6 nodes)',
      description: 'Classic directed weighted graph for shortest-path demonstration.',
      graph: {
        directed: true, weighted: true,
        vertices: [
          { id: 'cv1', label: 'A', x: 100, y: 200 },
          { id: 'cv2', label: 'B', x: 250, y: 100 },
          { id: 'cv3', label: 'C', x: 250, y: 300 },
          { id: 'cv4', label: 'D', x: 400, y: 100 },
          { id: 'cv5', label: 'E', x: 400, y: 300 },
          { id: 'cv6', label: 'F', x: 550, y: 200 },
        ],
        edges: [
          { id: 'ce1',  source: 'cv1', target: 'cv2', weight: 7,  directed: true },
          { id: 'ce2',  source: 'cv1', target: 'cv3', weight: 9,  directed: true },
          { id: 'ce3',  source: 'cv2', target: 'cv4', weight: 10, directed: true },
          { id: 'ce4',  source: 'cv2', target: 'cv3', weight: 2,  directed: true },
          { id: 'ce5',  source: 'cv3', target: 'cv5', weight: 11, directed: true },
          { id: 'ce6',  source: 'cv4', target: 'cv6', weight: 4,  directed: true },
          { id: 'ce7',  source: 'cv5', target: 'cv4', weight: 1,  directed: true },
          { id: 'ce8',  source: 'cv5', target: 'cv6', weight: 7,  directed: true },
        ],
      },
      defaultParams: { mode: false, source: 'cv1', target: 'cv6' },
    },
    {
      name: 'Longest Path (5 nodes)',
      description: 'MAX variant: find the path with the highest total weight.',
      graph: {
        directed: true, weighted: true,
        vertices: [
          { id: 'lv1', label: 'S', x: 80,  y: 200 },
          { id: 'lv2', label: 'B', x: 230, y: 100 },
          { id: 'lv3', label: 'C', x: 230, y: 300 },
          { id: 'lv4', label: 'D', x: 380, y: 200 },
          { id: 'lv5', label: 'T', x: 530, y: 200 },
        ],
        edges: [
          { id: 'le1', source: 'lv1', target: 'lv2', weight: 3,  directed: true },
          { id: 'le2', source: 'lv1', target: 'lv3', weight: 5,  directed: true },
          { id: 'le3', source: 'lv2', target: 'lv4', weight: 6,  directed: true },
          { id: 'le4', source: 'lv3', target: 'lv4', weight: 4,  directed: true },
          { id: 'le5', source: 'lv3', target: 'lv5', weight: 2,  directed: true },
          { id: 'le6', source: 'lv4', target: 'lv5', weight: 8,  directed: true },
        ],
      },
      defaultParams: { mode: true, source: 'lv1', target: 'lv5' },
    },
  ],
  validate(graph) {
    if (graph.vertices.length < 2) return 'Graph needs at least 2 vertices.';
    if (!graph.weighted)           return 'Demoucron Optimal Path requires a weighted graph.';
    if (!graph.directed)           return 'Demoucron Optimal Path requires a directed graph.';
    return null;
  },
  run: runDemoucronCho,
};
