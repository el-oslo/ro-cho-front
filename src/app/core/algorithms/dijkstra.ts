import { Graph, Vertex, Edge } from '../models/graph.models';
import { AlgorithmStep, AlgorithmDef, VertexState, EdgeState } from '../models/algorithm.models';

// Min-heap priority queue
class MinHeap {
  private heap: { id: string; dist: number }[] = [];

  push(id: string, dist: number) {
    this.heap.push({ id, dist });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): { id: string; dist: number } | undefined {
    if (!this.heap.length) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length) { this.heap[0] = last; this.sinkDown(0); }
    return top;
  }

  get size() { return this.heap.length; }

  private bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].dist <= this.heap[i].dist) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private sinkDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.heap[l].dist < this.heap[smallest].dist) smallest = l;
      if (r < n && this.heap[r].dist < this.heap[smallest].dist) smallest = r;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

function buildPath(previous: Record<string, string | null>, target: string): string[] {
  const path: string[] = [];
  let cur: string | null = target;
  while (cur) { path.unshift(cur); cur = previous[cur] ?? null; }
  return path;
}

function edgeId(graph: Graph, src: string, tgt: string): string | undefined {
  return graph.edges.find(
    e => (e.source === src && e.target === tgt) ||
         (!graph.directed && e.source === tgt && e.target === src)
  )?.id;
}

export function runDijkstra(graph: Graph, params: Record<string, unknown>): AlgorithmStep[] {
  const source = params['source'] as string;
  const target = params['target'] as string | undefined;
  const steps: AlgorithmStep[] = [];
  const inf = Infinity;

  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  const visited = new Set<string>();

  for (const v of graph.vertices) { distances[v.id] = inf; previous[v.id] = null; }
  distances[source] = 0;

  const pq = new MinHeap();
  pq.push(source, 0);

  const makeStep = (desc: string, activeId?: string, relaxedEdgeId?: string, currentPath: string[] = []): AlgorithmStep => {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates: Record<string, EdgeState> = {};

    for (const v of graph.vertices) {
      if (visited.has(v.id)) vertexStates[v.id] = 'visited';
      else if (distances[v.id] < inf) vertexStates[v.id] = 'frontier';
      else vertexStates[v.id] = 'unvisited';
    }
    for (const id of currentPath) vertexStates[id] = 'path';
    if (activeId) vertexStates[activeId] = 'active';

    for (const e of graph.edges) edgeStates[e.id] = 'default';
    if (relaxedEdgeId) edgeStates[relaxedEdgeId] = 'traversed';
    for (let i = 0; i < currentPath.length - 1; i++) {
      const eid = edgeId(graph, currentPath[i], currentPath[i + 1]);
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
        visited: [...visited],
        currentPath,
      },
    };
  };

  steps.push(makeStep(`Initialise: distance to ${graph.vertices.find(v => v.id === source)?.label} = 0`));

  while (pq.size > 0) {
    const { id: u, dist: du } = pq.pop()!;
    if (visited.has(u)) continue;
    visited.add(u);

    const uLabel = graph.vertices.find(v => v.id === u)?.label ?? u;
    const path = target ? buildPath(previous, u) : [];
    steps.push(makeStep(`Visit ${uLabel} (dist = ${du === inf ? '∞' : du})`, u, undefined, path));

    if (target && u === target) break;

    const neighbors = graph.edges.filter(e =>
      e.source === u || (!graph.directed && e.target === u)
    );

    for (const edge of neighbors) {
      const v = edge.source === u ? edge.target : edge.source;
      if (visited.has(v)) continue;
      const w = edge.weight ?? 1;
      const newDist = distances[u] + w;
      if (newDist < distances[v]) {
        distances[v] = newDist;
        previous[v] = u;
        pq.push(v, newDist);
        const vLabel = graph.vertices.find(x => x.id === v)?.label ?? v;
        steps.push(makeStep(
          `Relax edge ${uLabel}→${vLabel}: dist[${vLabel}] = ${newDist}`,
          u, edge.id, target ? buildPath(previous, v) : []
        ));
      }
    }
  }

  const finalPath = target ? buildPath(previous, target) : [];
  const finalDist = target ? distances[target] : null;
  steps.push(makeStep(
    target
      ? `Done. Shortest path to ${graph.vertices.find(v => v.id === target)?.label}: ${finalDist === inf ? 'unreachable' : finalDist}`
      : `Done. All reachable vertices processed.`,
    undefined, undefined, finalPath
  ));

  // Mark final path
  if (finalPath.length > 1 && steps.length > 0) {
    const last = steps[steps.length - 1];
    for (const id of finalPath) last.vertexStates[id] = 'path';
    for (let i = 0; i < finalPath.length - 1; i++) {
      const eid = edgeId(graph, finalPath[i], finalPath[i + 1]);
      if (eid) last.edgeStates[eid] = 'path';
    }
  }

  return steps;
}

export const dijkstraDef: AlgorithmDef = {
  id: 'dijkstra',
  name: "Dijkstra's Algorithm",
  description: 'Finds shortest paths from a source vertex using a min-heap priority queue. Requires non-negative edge weights.',
  requiresWeights: true,
  requiresDirected: null,
  inputs: [
    { key: 'source', label: 'Source vertex', type: 'vertex-select', required: true },
    { key: 'target', label: 'Target vertex (optional)', type: 'vertex-select', required: false },
  ],
  presets: [
    {
      name: 'City Map (6 nodes)',
      description: '6-node weighted undirected graph representing a city road network.',
      graph: {
        directed: false, weighted: true,
        vertices: [
          { id: 'v1', label: 'A', x: 120, y: 200 },
          { id: 'v2', label: 'B', x: 300, y: 100 },
          { id: 'v3', label: 'C', x: 480, y: 200 },
          { id: 'v4', label: 'D', x: 300, y: 300 },
          { id: 'v5', label: 'E', x: 180, y: 380 },
          { id: 'v6', label: 'F', x: 420, y: 380 },
        ],
        edges: [
          { id: 'e1', source: 'v1', target: 'v2', weight: 4, directed: false },
          { id: 'e2', source: 'v1', target: 'v4', weight: 2, directed: false },
          { id: 'e3', source: 'v2', target: 'v3', weight: 5, directed: false },
          { id: 'e4', source: 'v2', target: 'v4', weight: 1, directed: false },
          { id: 'e5', source: 'v3', target: 'v6', weight: 3, directed: false },
          { id: 'e6', source: 'v4', target: 'v5', weight: 4, directed: false },
          { id: 'e7', source: 'v4', target: 'v6', weight: 6, directed: false },
          { id: 'e8', source: 'v5', target: 'v6', weight: 2, directed: false },
        ],
      },
      defaultParams: { source: 'v1', target: 'v6' },
    },
    {
      name: 'Directed Network (7 nodes)',
      description: '7-node weighted directed graph simulating a routing network.',
      graph: {
        directed: true, weighted: true,
        vertices: [
          { id: 'n1', label: 'S', x: 80, y: 240 },
          { id: 'n2', label: 'A', x: 220, y: 140 },
          { id: 'n3', label: 'B', x: 220, y: 340 },
          { id: 'n4', label: 'C', x: 360, y: 240 },
          { id: 'n5', label: 'D', x: 500, y: 140 },
          { id: 'n6', label: 'E', x: 500, y: 340 },
          { id: 'n7', label: 'T', x: 620, y: 240 },
        ],
        edges: [
          { id: 'f1', source: 'n1', target: 'n2', weight: 3, directed: true },
          { id: 'f2', source: 'n1', target: 'n3', weight: 5, directed: true },
          { id: 'f3', source: 'n2', target: 'n4', weight: 2, directed: true },
          { id: 'f4', source: 'n3', target: 'n4', weight: 4, directed: true },
          { id: 'f5', source: 'n4', target: 'n5', weight: 1, directed: true },
          { id: 'f6', source: 'n4', target: 'n6', weight: 6, directed: true },
          { id: 'f7', source: 'n5', target: 'n7', weight: 2, directed: true },
          { id: 'f8', source: 'n6', target: 'n7', weight: 3, directed: true },
        ],
      },
      defaultParams: { source: 'n1', target: 'n7' },
    },
  ],
  validate(graph) {
    if (!graph.weighted) return 'Dijkstra requires a weighted graph.';
    const neg = graph.edges.find(e => (e.weight ?? 0) < 0);
    if (neg) return 'Dijkstra does not support negative edge weights.';
    return null;
  },
  run: runDijkstra,
};
