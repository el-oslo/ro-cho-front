import { Graph, Vertex } from '../models/graph.models';
import { AlgorithmStep, AlgorithmDef, VertexState, EdgeState } from '../models/algorithm.models';

function euclidean(a: Vertex, b: Vertex): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function buildPath(cameFrom: Record<string, string | null>, target: string): string[] {
  const path: string[] = [];
  let cur: string | null = target;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.unshift(cur);
    cur = cameFrom[cur] ?? null;
  }
  return path;
}

export function runAstar(graph: Graph, params: Record<string, unknown>): AlgorithmStep[] {
  const source = params['source'] as string;
  const target = params['target'] as string;
  const steps: AlgorithmStep[] = [];

  const vertexMap = new Map(graph.vertices.map(v => [v.id, v]));
  const targetVertex = vertexMap.get(target)!;

  const g: Record<string, number> = {};
  const f: Record<string, number> = {};
  const h: Record<string, number> = {};
  const cameFrom: Record<string, string | null> = {};

  for (const v of graph.vertices) {
    g[v.id] = Infinity;
    h[v.id] = euclidean(v, targetVertex);
    f[v.id] = Infinity;
    cameFrom[v.id] = null;
  }
  g[source] = 0;
  f[source] = h[source];

  const openSet = new Set<string>([source]);
  const closedSet = new Set<string>();

  const makeStep = (desc: string, current?: string): AlgorithmStep => {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates: Record<string, EdgeState> = {};

    for (const v of graph.vertices) {
      if (closedSet.has(v.id)) vertexStates[v.id] = 'visited';
      else if (openSet.has(v.id)) vertexStates[v.id] = 'frontier';
      else vertexStates[v.id] = 'unvisited';
    }
    if (current) vertexStates[current] = 'active';

    const currentPath = current ? buildPath(cameFrom, current) : [];
    for (const id of currentPath) vertexStates[id] = 'path';
    if (current) vertexStates[current] = 'active';

    for (const e of graph.edges) edgeStates[e.id] = 'default';
    for (let i = 0; i < currentPath.length - 1; i++) {
      const eid = graph.edges.find(
        e => (e.source === currentPath[i] && e.target === currentPath[i + 1]) ||
             (!graph.directed && e.source === currentPath[i + 1] && e.target === currentPath[i])
      )?.id;
      if (eid) edgeStates[eid] = 'traversed';
    }

    const openArr = [...openSet].map(id => ({
      id,
      f: f[id] === Infinity ? '∞' : +f[id].toFixed(1),
      g: g[id] === Infinity ? '∞' : +g[id].toFixed(1),
      h: +h[id].toFixed(1),
    }));
    const closedArr = [...closedSet].map(id => ({
      id,
      finalCost: g[id] === Infinity ? '∞' : +g[id].toFixed(1),
    }));

    return {
      stepIndex: steps.length,
      description: desc,
      vertexStates,
      edgeStates,
      metadata: { openSet: openArr, closedSet: closedArr, currentPath, current },
    };
  };

  steps.push(makeStep(`Initialisation A* de ${vertexMap.get(source)?.label} à ${vertexMap.get(target)?.label}`));

  while (openSet.size > 0) {
    let current = [...openSet].reduce((a, b) => f[a] <= f[b] ? a : b);
    const currentLabel = vertexMap.get(current)?.label ?? current;
    steps.push(makeStep(
      `Évaluer ${currentLabel} — f = g + h = ${g[current].toFixed(1)} + ${h[current].toFixed(1)} = ${f[current].toFixed(1)}`,
      current
    ));

    if (current === target) {
      const path = buildPath(cameFrom, target);
      const last = steps[steps.length - 1];
      for (const id of path) last.vertexStates[id] = 'path';
      for (let i = 0; i < path.length - 1; i++) {
        const eid = graph.edges.find(
          e => (e.source === path[i] && e.target === path[i + 1]) ||
               (!graph.directed && e.source === path[i + 1] && e.target === path[i])
        )?.id;
        if (eid) last.edgeStates[eid] = 'path';
      }
      last.description = `Chemin trouvé ! Coût total : ${g[target].toFixed(1)}`;
      last.metadata = { ...last.metadata, currentPath: path };
      return steps;
    }

    openSet.delete(current);
    closedSet.add(current);

    const neighbors = graph.edges.filter(
      e => e.source === current || (!graph.directed && e.target === current)
    );

    for (const edge of neighbors) {
      const neighbor = edge.source === current ? edge.target : edge.source;
      if (closedSet.has(neighbor)) continue;
      const tentativeG = g[current] + (edge.weight ?? 1);
      if (tentativeG < g[neighbor]) {
        cameFrom[neighbor] = current;
        g[neighbor] = tentativeG;
        f[neighbor] = tentativeG + h[neighbor];
        openSet.add(neighbor);
        const nLabel = vertexMap.get(neighbor)?.label ?? neighbor;
        steps.push(makeStep(
          `Mettre à jour ${nLabel} : g=${tentativeG.toFixed(1)}, f=${f[neighbor].toFixed(1)}`,
          current
        ));
      }
    }
  }

  steps.push(makeStep(`Aucun chemin de ${vertexMap.get(source)?.label} à ${vertexMap.get(target)?.label}`));
  return steps;
}

export const astarDef: AlgorithmDef = {
  id: 'astar',
  name: 'Recherche A*',
  description: 'Recherche de chemin heuristique utilisant la distance euclidienne. Trouve les chemins optimaux plus vite que Dijkstra lorsque les positions sont pertinentes.',
  requiresWeights: true,
  requiresDirected: null,
  inputs: [
    { key: 'source', label: 'Sommet source', type: 'vertex-select', required: true },
    { key: 'target', label: 'Sommet cible', type: 'vertex-select', required: true },
  ],
  presets: [
    {
      name: 'Grille (9 nœuds)',
      description: 'Graphe en grille à 9 nœuds où la disposition spatiale rend l\'heuristique efficace.',
      graph: {
        directed: false, weighted: true,
        vertices: [
          { id: 'a1', label: 'A', x: 100, y: 100 },
          { id: 'a2', label: 'B', x: 280, y: 100 },
          { id: 'a3', label: 'C', x: 460, y: 100 },
          { id: 'a4', label: 'D', x: 100, y: 260 },
          { id: 'a5', label: 'E', x: 280, y: 260 },
          { id: 'a6', label: 'F', x: 460, y: 260 },
          { id: 'a7', label: 'G', x: 100, y: 420 },
          { id: 'a8', label: 'H', x: 280, y: 420 },
          { id: 'a9', label: 'I', x: 460, y: 420 },
        ],
        edges: [
          { id: 'ae1', source: 'a1', target: 'a2', weight: 2, directed: false },
          { id: 'ae2', source: 'a2', target: 'a3', weight: 2, directed: false },
          { id: 'ae3', source: 'a1', target: 'a4', weight: 2, directed: false },
          { id: 'ae4', source: 'a2', target: 'a5', weight: 2, directed: false },
          { id: 'ae5', source: 'a3', target: 'a6', weight: 2, directed: false },
          { id: 'ae6', source: 'a4', target: 'a5', weight: 2, directed: false },
          { id: 'ae7', source: 'a5', target: 'a6', weight: 2, directed: false },
          { id: 'ae8', source: 'a4', target: 'a7', weight: 2, directed: false },
          { id: 'ae9', source: 'a5', target: 'a8', weight: 2, directed: false },
          { id: 'ae10', source: 'a6', target: 'a9', weight: 2, directed: false },
          { id: 'ae11', source: 'a7', target: 'a8', weight: 2, directed: false },
          { id: 'ae12', source: 'a8', target: 'a9', weight: 2, directed: false },
          { id: 'ae13', source: 'a2', target: 'a4', weight: 5, directed: false },
        ],
      },
      defaultParams: { source: 'a1', target: 'a9' },
    },
    {
      name: 'Graphe clairsemé (7 nœuds)',
      description: 'Graphe clairsemé à 7 nœuds où l\'heuristique doit contourner un détour.',
      graph: {
        directed: false, weighted: true,
        vertices: [
          { id: 'b1', label: 'S', x: 80, y: 260 },
          { id: 'b2', label: 'A', x: 220, y: 140 },
          { id: 'b3', label: 'B', x: 380, y: 100 },
          { id: 'b4', label: 'C', x: 220, y: 380 },
          { id: 'b5', label: 'D', x: 380, y: 380 },
          { id: 'b6', label: 'E', x: 520, y: 260 },
          { id: 'b7', label: 'T', x: 640, y: 260 },
        ],
        edges: [
          { id: 'be1', source: 'b1', target: 'b2', weight: 3, directed: false },
          { id: 'be2', source: 'b1', target: 'b4', weight: 4, directed: false },
          { id: 'be3', source: 'b2', target: 'b3', weight: 3, directed: false },
          { id: 'be4', source: 'b3', target: 'b6', weight: 5, directed: false },
          { id: 'be5', source: 'b4', target: 'b5', weight: 3, directed: false },
          { id: 'be6', source: 'b5', target: 'b6', weight: 4, directed: false },
          { id: 'be7', source: 'b6', target: 'b7', weight: 2, directed: false },
        ],
      },
      defaultParams: { source: 'b1', target: 'b7' },
    },
  ],
  validate(graph) {
    if (!graph.weighted) return 'A* nécessite un graphe pondéré.';
    return null;
  },
  run: runAstar,
};
