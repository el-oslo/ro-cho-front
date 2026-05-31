import { Graph } from '../models/graph.models';
import { AlgorithmStep, AlgorithmDef, VertexState, EdgeState } from '../models/algorithm.models';

const MAX_STEPS = 10_000;

export function runDemoucron(graph: Graph, params: Record<string, unknown>): AlgorithmStep[] {
  const sourceParam = params['source'] as string | undefined;
  const targetParam = params['target'] as string | undefined;
  const steps: AlgorithmStep[] = [];

  const vertices = graph.vertices.map(v => v.id);
  const n = vertices.length;
  let backtracks = 0;
  let capped = false;

  const adj = new Map<string, Set<string>>();
  for (const v of vertices) adj.set(v, new Set());
  for (const e of graph.edges) {
    adj.get(e.source)!.add(e.target);
    if (!graph.directed) adj.get(e.target)!.add(e.source);
  }

  // Ore's theorem pruning: check if the remaining graph can still complete the path
  function canContinue(path: string[], remaining: Set<string>): boolean {
    if (remaining.size === 0) return true;
    const last = path[path.length - 1];
    return [...adj.get(last)!].some(nb => remaining.has(nb));
  }

  const makeStep = (
    desc: string,
    currentPath: string[],
    status: 'searching' | 'found' | 'no-path'
  ): AlgorithmStep => {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates: Record<string, EdgeState> = {};

    const pathSet = new Set(currentPath);
    for (const v of graph.vertices) {
      vertexStates[v.id] = pathSet.has(v.id) ? 'path' : 'unvisited';
    }
    if (currentPath.length > 0) vertexStates[currentPath[currentPath.length - 1]] = 'active';

    for (const e of graph.edges) edgeStates[e.id] = 'default';
    for (let i = 0; i < currentPath.length - 1; i++) {
      const u = currentPath[i], v = currentPath[i + 1];
      const eid = graph.edges.find(
        e => (e.source === u && e.target === v) ||
             (!graph.directed && e.source === v && e.target === u)
      )?.id;
      if (eid) edgeStates[eid] = 'path';
    }

    return {
      stepIndex: steps.length,
      description: desc,
      vertexStates,
      edgeStates,
      metadata: { currentPath: [...currentPath], backtracks, status },
    };
  };

  let found = false;

  function backtrack(path: string[], remaining: Set<string>): boolean {
    if (steps.length >= MAX_STEPS) { capped = true; return false; }

    if (remaining.size === 0) {
      if (targetParam && path[path.length - 1] !== targetParam) return false;
      found = true;
      steps.push(makeStep(`Hamiltonian path found: ${path.map(id => graph.vertices.find(v => v.id === id)?.label).join(' → ')}`, path, 'found'));
      return true;
    }

    const last = path[path.length - 1];
    const neighbors = [...adj.get(last)!].filter(nb => remaining.has(nb));

    for (const nb of neighbors) {
      if (steps.length >= MAX_STEPS) { capped = true; return false; }
      path.push(nb);
      remaining.delete(nb);
      const label = graph.vertices.find(v => v.id === nb)?.label ?? nb;
      steps.push(makeStep(`Try extending path to ${label}`, path, 'searching'));

      if (canContinue(path, remaining)) {
        if (backtrack(path, remaining)) return true;
      }

      path.pop();
      remaining.add(nb);
      backtracks++;
      steps.push(makeStep(`Backtrack from ${label} (${backtracks} backtracks total)`, path, 'searching'));
    }

    return false;
  }

  const startVertices = sourceParam ? [sourceParam] : vertices;

  for (const start of startVertices) {
    if (steps.length >= MAX_STEPS) { capped = true; break; }
    const remaining = new Set(vertices.filter(v => v !== start));
    const path = [start];
    const startLabel = graph.vertices.find(v => v.id === start)?.label ?? start;
    steps.push(makeStep(`Start search from ${startLabel}`, path, 'searching'));

    if (backtrack(path, remaining)) break;
  }

  if (!found && !capped) {
    steps.push(makeStep('No Hamiltonian path exists in this graph.', [], 'no-path'));
  } else if (capped) {
    steps.push(makeStep(`Search capped at ${MAX_STEPS} steps — graph may be too large.`, [], 'no-path'));
  }

  return steps;
}

export const demoucronDef: AlgorithmDef = {
  id: 'demoucron',
  name: 'Demoucron Hamiltonian Path',
  description: 'Backtracking search for a Hamiltonian path (visits every vertex exactly once), with Ore\'s theorem pruning.',
  requiresWeights: false,
  requiresDirected: null,
  inputs: [
    { key: 'source', label: 'Start vertex (optional)', type: 'vertex-select', required: false },
    { key: 'target', label: 'End vertex (optional)', type: 'vertex-select', required: false },
  ],
  presets: [
    {
      name: 'Complete Graph K5',
      description: '5-node complete graph — a Hamiltonian path always exists.',
      graph: {
        directed: false, weighted: false,
        vertices: [
          { id: 'k1', label: 'A', x: 300, y: 80 },
          { id: 'k2', label: 'B', x: 500, y: 220 },
          { id: 'k3', label: 'C', x: 420, y: 430 },
          { id: 'k4', label: 'D', x: 180, y: 430 },
          { id: 'k5', label: 'E', x: 100, y: 220 },
        ],
        edges: [
          { id: 'ke1', source: 'k1', target: 'k2', directed: false },
          { id: 'ke2', source: 'k1', target: 'k3', directed: false },
          { id: 'ke3', source: 'k1', target: 'k4', directed: false },
          { id: 'ke4', source: 'k1', target: 'k5', directed: false },
          { id: 'ke5', source: 'k2', target: 'k3', directed: false },
          { id: 'ke6', source: 'k2', target: 'k4', directed: false },
          { id: 'ke7', source: 'k2', target: 'k5', directed: false },
          { id: 'ke8', source: 'k3', target: 'k4', directed: false },
          { id: 'ke9', source: 'k3', target: 'k5', directed: false },
          { id: 'ke10', source: 'k4', target: 'k5', directed: false },
        ],
      },
      defaultParams: {},
    },
    {
      name: 'No Hamiltonian Path (6 nodes)',
      description: '6-node graph where the structure prevents a Hamiltonian path.',
      graph: {
        directed: false, weighted: false,
        vertices: [
          { id: 'm1', label: 'A', x: 160, y: 160 },
          { id: 'm2', label: 'B', x: 360, y: 100 },
          { id: 'm3', label: 'C', x: 520, y: 200 },
          { id: 'm4', label: 'D', x: 480, y: 380 },
          { id: 'm5', label: 'E', x: 280, y: 420 },
          { id: 'm6', label: 'F', x: 160, y: 320 },
        ],
        edges: [
          { id: 'me1', source: 'm1', target: 'm2', directed: false },
          { id: 'me2', source: 'm2', target: 'm3', directed: false },
          { id: 'me3', source: 'm3', target: 'm4', directed: false },
          { id: 'me4', source: 'm4', target: 'm5', directed: false },
          { id: 'me5', source: 'm1', target: 'm6', directed: false },
          { id: 'me6', source: 'm2', target: 'm5', directed: false },
        ],
      },
      defaultParams: {},
    },
  ],
  validate(graph) {
    if (graph.vertices.length > 12) {
      return 'Warning: graph has more than 12 vertices. The search may be very slow.';
    }
    return null;
  },
  run: runDemoucron,
};
