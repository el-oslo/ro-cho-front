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

  const adj = new Map<string, string[]>();
  for (const v of vertices) adj.set(v, []);
  for (const e of graph.edges) {
    adj.get(e.source)!.push(e.target);
    if (!graph.directed) adj.get(e.target)!.push(e.source);
  }

  // ── Pruning heuristics ───────────────────────────────────────────────────

  // Warnsdorff count: how many unvisited neighbours does nb still have?
  function warnsdorffDeg(nb: string, remaining: Set<string>): number {
    return (adj.get(nb) ?? []).filter(x => remaining.has(x)).length;
  }

  // BFS connectivity: can we reach every node in `remaining` from `last`?
  function isConnected(last: string, remaining: Set<string>): boolean {
    if (remaining.size === 0) return true;
    const visited = new Set<string>([last]);
    const queue: string[] = [last];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      for (const nb of (adj.get(cur) ?? [])) {
        if (remaining.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    for (const r of remaining) {
      if (!visited.has(r)) return false;
    }
    return true;
  }

  // ── Step builder ─────────────────────────────────────────────────────────

  function makeStep(
    desc: string,
    currentPath: string[],
    status: 'searching' | 'found' | 'no-path'
  ): AlgorithmStep {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates:   Record<string, EdgeState>   = {};

    const pathSet = new Set(currentPath);
    for (const v of graph.vertices) {
      vertexStates[v.id] = pathSet.has(v.id) ? 'path' : 'unvisited';
    }
    if (currentPath.length > 0) {
      vertexStates[currentPath[currentPath.length - 1]] = 'active';
    }
    if (status === 'no-path') {
      for (const v of graph.vertices) vertexStates[v.id] = 'rejected';
    }

    for (const e of graph.edges) edgeStates[e.id] = 'default';
    for (let i = 0; i < currentPath.length - 1; i++) {
      const [u, v] = [currentPath[i], currentPath[i + 1]];
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
      metadata: { currentPath: [...currentPath], backtracks, status, capped },
    };
  }

  // ── Backtracking search ──────────────────────────────────────────────────

  let found = false;

  function backtrack(path: string[], remaining: Set<string>): boolean {
    if (steps.length >= MAX_STEPS) { capped = true; return false; }

    if (remaining.size === 0) {
      if (targetParam && path[path.length - 1] !== targetParam) return false;
      found = true;
      steps.push(makeStep(
        `Chemin hamiltonien trouvé : ${path.map(id => graph.vertices.find(v => v.id === id)?.label ?? id).join(' → ')}`,
        path, 'found'
      ));
      return true;
    }

    const last = path[path.length - 1];

    // BFS connectivity pruning: if remaining nodes are unreachable from here, prune
    if (!isConnected(last, remaining)) {
      backtracks++;
      const lastLabel = graph.vertices.find(v => v.id === last)?.label ?? last;
      steps.push(makeStep(
        `Élagage en ${lastLabel} — graphe résiduel déconnecté (${backtracks} retours arrière)`,
        path, 'searching'
      ));
      return false;
    }

    // Collect neighbours that are still unvisited
    let neighbours = (adj.get(last) ?? []).filter(nb => remaining.has(nb));

    // Skip target until it is the only node left
    if (targetParam && remaining.size > 1) {
      neighbours = neighbours.filter(nb => nb !== targetParam);
    }

    // Warnsdorff ordering: try neighbours with fewest unvisited connections first
    neighbours.sort((a, b) => warnsdorffDeg(a, remaining) - warnsdorffDeg(b, remaining));

    for (const nb of neighbours) {
      if (steps.length >= MAX_STEPS) { capped = true; return false; }

      path.push(nb);
      remaining.delete(nb);
      const nbLabel = graph.vertices.find(v => v.id === nb)?.label ?? nb;
      steps.push(makeStep(`Étendre le chemin vers ${nbLabel}`, path, 'searching'));

      if (backtrack(path, remaining)) return true;

      path.pop();
      remaining.add(nb);
      backtracks++;
      steps.push(makeStep(`Retour arrière depuis ${nbLabel} (${backtracks} au total)`, path, 'searching'));
    }

    return false;
  }

  const startVertices = sourceParam ? [sourceParam] : vertices;

  for (const start of startVertices) {
    if (steps.length >= MAX_STEPS) { capped = true; break; }
    const remaining = new Set(vertices.filter(v => v !== start));
    const path = [start];
    const startLabel = graph.vertices.find(v => v.id === start)?.label ?? start;
    steps.push(makeStep(`Démarrer la recherche depuis ${startLabel}`, path, 'searching'));

    if (backtrack(path, remaining)) break;
  }

  if (!found && !capped) {
    steps.push(makeStep('Aucun chemin hamiltonien n\'existe dans ce graphe.', [], 'no-path'));
  } else if (capped) {
    steps.push(makeStep(`Recherche limitée à ${MAX_STEPS} étapes — le graphe est peut-être trop grand.`, [], 'no-path'));
  }

  return steps;
}

export const demoucronDef: AlgorithmDef = {
  id: 'demoucron',
  name: 'Demoucron — Chemin Hamiltonien',
  description:
    'Recherche par retour arrière d\'un chemin hamiltonien (visite chaque sommet exactement une fois). ' +
    'Utilise la règle de Warnsdorff (essayer d\'abord les voisins de faible degré) et l\'élagage par connexité BFS.',
  requiresWeights: false,
  requiresDirected: null,
  inputs: [
    { key: 'source', label: 'Sommet de départ (optionnel)', type: 'vertex-select', required: false },
    { key: 'target', label: 'Sommet d\'arrivée (optionnel)', type: 'vertex-select', required: false },
  ],
  presets: [
    {
      name: 'Graphe complet K5',
      description: 'Graphe complet à 5 nœuds — un chemin hamiltonien existe toujours.',
      graph: {
        directed: false, weighted: false,
        vertices: [
          { id: 'k1', label: 'A', x: 300, y: 80  },
          { id: 'k2', label: 'B', x: 500, y: 220 },
          { id: 'k3', label: 'C', x: 420, y: 430 },
          { id: 'k4', label: 'D', x: 180, y: 430 },
          { id: 'k5', label: 'E', x: 100, y: 220 },
        ],
        edges: [
          { id: 'ke1',  source: 'k1', target: 'k2', directed: false },
          { id: 'ke2',  source: 'k1', target: 'k3', directed: false },
          { id: 'ke3',  source: 'k1', target: 'k4', directed: false },
          { id: 'ke4',  source: 'k1', target: 'k5', directed: false },
          { id: 'ke5',  source: 'k2', target: 'k3', directed: false },
          { id: 'ke6',  source: 'k2', target: 'k4', directed: false },
          { id: 'ke7',  source: 'k2', target: 'k5', directed: false },
          { id: 'ke8',  source: 'k3', target: 'k4', directed: false },
          { id: 'ke9',  source: 'k3', target: 'k5', directed: false },
          { id: 'ke10', source: 'k4', target: 'k5', directed: false },
        ],
      },
      defaultParams: {},
    },
    {
      name: 'Sans chemin hamiltonien (6 nœuds)',
      description: 'Graphe à 6 nœuds dont la structure empêche l\'existence d\'un chemin hamiltonien.',
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
      return 'Attention : plus de 12 sommets — la recherche peut être lente.';
    }
    return null;
  },
  run: runDemoucron,
};
