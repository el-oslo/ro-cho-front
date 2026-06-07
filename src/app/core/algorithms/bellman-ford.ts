import { Graph } from '../models/graph.models';
import { AlgorithmStep, AlgorithmDef, VertexState, EdgeState } from '../models/algorithm.models';

function buildPath(previous: Record<string, string | null>, target: string): string[] {
  const path: string[] = [];
  let cur: string | null = target;
  const visited = new Set<string>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    path.unshift(cur);
    cur = previous[cur] ?? null;
  }
  return path;
}

function edgeKey(graph: Graph, src: string, tgt: string): string | undefined {
  return graph.edges.find(
    e => (e.source === src && e.target === tgt) ||
         (!graph.directed && e.source === tgt && e.target === src)
  )?.id;
}

export function runBellmanFord(graph: Graph, params: Record<string, unknown>): AlgorithmStep[] {
  const source = params['source'] as string;
  const target = params['target'] as string | undefined;
  const steps: AlgorithmStep[] = [];
  const inf = Infinity;
  const n = graph.vertices.length;

  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  for (const v of graph.vertices) { distances[v.id] = inf; previous[v.id] = null; }
  distances[source] = 0;

  let negCycleDetected = false;

  const makeStep = (desc: string, pass: number, activeEdgeId?: string, currentPath: string[] = []): AlgorithmStep => {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates: Record<string, EdgeState> = {};

    for (const v of graph.vertices) {
      vertexStates[v.id] = distances[v.id] === inf ? 'unvisited' : 'visited';
    }
    for (const id of currentPath) vertexStates[id] = 'path';

    for (const e of graph.edges) edgeStates[e.id] = 'default';
    if (activeEdgeId) edgeStates[activeEdgeId] = 'traversed';
    for (let i = 0; i < currentPath.length - 1; i++) {
      const eid = edgeKey(graph, currentPath[i], currentPath[i + 1]);
      if (eid) edgeStates[eid] = 'path';
    }

    return {
      stepIndex: steps.length,
      description: desc,
      vertexStates,
      edgeStates,
      metadata: {
        distances: { ...distances },
        previous: { ...previous },
        pass,
        negCycleDetected,
      },
    };
  };

  steps.push(makeStep(`Initialisation Bellman-Ford depuis ${graph.vertices.find(v => v.id === source)?.label}`, 0));

  const allEdges = graph.directed
    ? graph.edges
    : [
        ...graph.edges,
        ...graph.edges.map(e => ({ ...e, source: e.target, target: e.source, id: e.id + '_r' })),
      ];

  for (let pass = 1; pass <= n - 1; pass++) {
    let relaxed = false;
    for (const edge of allEdges) {
      const { source: u, target: v, weight: w = 1 } = edge;
      if (distances[u] === inf) continue;
      const newDist = distances[u] + w;
      if (newDist < distances[v]) {
        distances[v] = newDist;
        previous[v] = u;
        relaxed = true;
        const uLabel = graph.vertices.find(x => x.id === u)?.label ?? u;
        const vLabel = graph.vertices.find(x => x.id === v)?.label ?? v;
        const realEdgeId = graph.edges.find(e =>
          (e.source === u && e.target === v) ||
          (!graph.directed && e.source === v && e.target === u)
        )?.id;
        steps.push(makeStep(
          `Passe ${pass} : relâcher ${uLabel}→${vLabel}, dist[${vLabel}] = ${newDist}`,
          pass, realEdgeId,
          target ? buildPath(previous, target) : []
        ));
      }
    }
    if (!relaxed) {
      steps.push(makeStep(`Passe ${pass} : aucune relaxation — arrêt anticipé`, pass));
      break;
    }
  }

  // Extra pass: detect negative cycle
  for (const edge of allEdges) {
    const { source: u, target: v, weight: w = 1 } = edge;
    if (distances[u] !== inf && distances[u] + w < distances[v]) {
      negCycleDetected = true;
      break;
    }
  }

  const finalPath = target ? buildPath(previous, target) : [];
  const finalDist = target ? distances[target] : null;
  steps.push(makeStep(
    negCycleDetected
      ? '⚠ Cycle négatif détecté !'
      : target
        ? `Terminé. Plus courte distance vers ${graph.vertices.find(v => v.id === target)?.label} : ${finalDist === inf ? 'inaccessible' : finalDist}`
        : 'Terminé. Toutes les distances calculées.',
    n,
    undefined,
    finalPath
  ));

  if (finalPath.length > 1 && steps.length > 0) {
    const last = steps[steps.length - 1];
    for (const id of finalPath) last.vertexStates[id] = 'path';
    for (let i = 0; i < finalPath.length - 1; i++) {
      const eid = edgeKey(graph, finalPath[i], finalPath[i + 1]);
      if (eid) last.edgeStates[eid] = 'path';
    }
  }

  return steps;
}

export const bellmanFordDef: AlgorithmDef = {
  id: 'bellman-ford',
  name: 'Algorithme de Bellman-Ford',
  description: 'Calcule les plus courts chemins depuis une source, supporte les poids négatifs et détecte les cycles négatifs.',
  requiresWeights: true,
  requiresDirected: null,
  inputs: [
    { key: 'source', label: 'Sommet source', type: 'vertex-select', required: true },
    { key: 'target', label: 'Sommet cible (optionnel)', type: 'vertex-select', required: false },
  ],
  presets: [
    {
      name: 'Graphe à arête négative (5 nœuds)',
      description: 'Graphe à 5 nœuds avec une arête de poids négatif — Dijkstra échouerait ici.',
      graph: {
        directed: true, weighted: true,
        vertices: [
          { id: 'p1', label: 'A', x: 100, y: 240 },
          { id: 'p2', label: 'B', x: 260, y: 120 },
          { id: 'p3', label: 'C', x: 420, y: 120 },
          { id: 'p4', label: 'D', x: 420, y: 360 },
          { id: 'p5', label: 'E', x: 580, y: 240 },
        ],
        edges: [
          { id: 'g1', source: 'p1', target: 'p2', weight: 6, directed: true },
          { id: 'g2', source: 'p1', target: 'p3', weight: 7, directed: true },
          { id: 'g3', source: 'p2', target: 'p3', weight: 8, directed: true },
          { id: 'g4', source: 'p2', target: 'p4', weight: -4, directed: true },
          { id: 'g5', source: 'p3', target: 'p5', weight: 9, directed: true },
          { id: 'g6', source: 'p4', target: 'p5', weight: 2, directed: true },
          { id: 'g7', source: 'p5', target: 'p1', weight: -3, directed: true },
        ],
      },
      defaultParams: { source: 'p1' },
    },
    {
      name: 'Cycle négatif (6 nœuds)',
      description: 'Graphe orienté à 6 nœuds contenant un cycle de poids négatif.',
      graph: {
        directed: true, weighted: true,
        vertices: [
          { id: 'q1', label: 'S', x: 100, y: 240 },
          { id: 'q2', label: 'A', x: 260, y: 120 },
          { id: 'q3', label: 'B', x: 420, y: 120 },
          { id: 'q4', label: 'C', x: 580, y: 240 },
          { id: 'q5', label: 'D', x: 420, y: 360 },
          { id: 'q6', label: 'E', x: 260, y: 360 },
        ],
        edges: [
          { id: 'h1', source: 'q1', target: 'q2', weight: 1, directed: true },
          { id: 'h2', source: 'q2', target: 'q3', weight: 2, directed: true },
          { id: 'h3', source: 'q3', target: 'q4', weight: 3, directed: true },
          { id: 'h4', source: 'q4', target: 'q5', weight: -10, directed: true },
          { id: 'h5', source: 'q5', target: 'q6', weight: 2, directed: true },
          { id: 'h6', source: 'q6', target: 'q3', weight: 1, directed: true },
        ],
      },
      defaultParams: { source: 'q1' },
    },
  ],
  validate(graph) {
    if (!graph.weighted) return 'Bellman-Ford nécessite un graphe pondéré.';
    return null;
  },
  run: runBellmanFord,
};
