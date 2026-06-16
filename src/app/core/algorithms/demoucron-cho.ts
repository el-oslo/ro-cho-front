/**
 * Demoucron — Chemin Optimal (Optimal Path)
 *
 * Floyd-Warshall style iterative matrix relaxation for directed weighted graphs.
 * Supports both min (shortest) and max (longest) path objectives.
 */

import { Graph } from '../models/graph.models';
import { AlgorithmStep, AlgorithmDef, VertexState, EdgeState } from '../models/algorithm.models';

const INF  =  Infinity;
const NINF = -Infinity;

type Matrix        = number[][];
// Each cell stores all valid intermediate vertices (null = direct edge, number = via vertex k)
type PrevAllMatrix = ((number | null)[])[][];

interface ChoMeta {
  matrixSnapshot:      (number | string)[][];
  matrixIndex:         number;   // 0 = D⁰ (init), k+1 = D^(k+1) after pass k
  vertexLabels:        string[];
  currentIntermediate: string | null;
  currentI:            number | null;
  currentJ:            number | null;
  wValue:              number | null;
  improved:            boolean;
  tied:                boolean;
  optimalPath:         string[];   // first path (backward compat)
  optimalPaths:        string[][];
  optimalValue:        number | null;
  mode:                'min' | 'max';
  phase:               'init' | 'relaxation' | 'reconstruction' | 'done';
}

function displayVal(v: number): string {
  if (v === INF)  return '+∞';
  if (v === NINF) return '-∞';
  return String(v);
}

function snapshot(m: Matrix): (number | string)[][] {
  return m.map(row => row.map(v => (v === INF || v === NINF) ? displayVal(v) : v));
}

function clone(m: Matrix): Matrix {
  return m.map(row => [...row]);
}

// Returns up to 2 optimal paths from src to tgt using the prevAll matrix.
function reconstructAllPaths(
  prevAll: PrevAllMatrix,
  V: Matrix,
  EMPTY: number,
  src: number,
  tgt: number,
  visiting: Set<string> = new Set()
): number[][] {
  if (src === tgt) return [[src]];
  const key = `${src}-${tgt}`;
  if (visiting.has(key)) return [];
  const intermediates = prevAll[src][tgt];
  if (!intermediates || intermediates.length === 0) {
    return V[src][tgt] !== EMPTY ? [[src, tgt]] : [];
  }
  const result: number[][] = [];
  const next = new Set([...visiting, key]);
  for (const k of intermediates) {
    if (result.length >= 2) break;
    if (k === null) {
      result.push([src, tgt]);
    } else {
      const lefts  = reconstructAllPaths(prevAll, V, EMPTY, src, k, next);
      const rights = reconstructAllPaths(prevAll, V, EMPTY, k, tgt, next);
      for (const lp of lefts) {
        for (const rp of rights) {
          if (result.length >= 2) break;
          result.push([...lp, ...rp.slice(1)]);
        }
        if (result.length >= 2) break;
      }
    }
  }
  return result;
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

  const V: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : EMPTY))
  );
  // prevAll[i][j] = [] means no path; [null] means direct edge; [k] means via vertex k
  const prevAll: PrevAllMatrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => [] as (number | null)[])
  );

  for (const edge of graph.edges) {
    const i = idToIdx.get(edge.source);
    const j = idToIdx.get(edge.target);
    if (i === undefined || j === undefined) continue;
    const w = edge.weight ?? 1;
    if (betterThan(w, V[i][j])) {
      V[i][j] = w;
      prevAll[i][j] = [null];
    }
    if (!graph.directed) {
      if (betterThan(w, V[j][i])) {
        V[j][i] = w;
        prevAll[j][i] = [null];
      }
    }
  }

  // pathIdxList: first entry = path1 ('path' state/red), second = path2 ('path2' state/green)
  function buildStates(
    hI: number | null,
    hJ: number | null,
    hK: number | null,
    pathIdxList: number[][]
  ): { vertexStates: Record<string, VertexState>; edgeStates: Record<string, EdgeState> } {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates:   Record<string, EdgeState>   = {};

    const [path1 = [], path2 = []] = pathIdxList;

    const pathSet1 = new Set(path1);
    const pathSet2 = new Set(path2);

    const pathEdges1 = new Set<string>();
    for (let p = 0; p < path1.length - 1; p++) {
      const a = vertices[path1[p]].id, b = vertices[path1[p + 1]].id;
      pathEdges1.add(`${a}->${b}`);
      if (!graph.directed) pathEdges1.add(`${b}->${a}`);
    }

    const pathEdges2 = new Set<string>();
    for (let p = 0; p < path2.length - 1; p++) {
      const a = vertices[path2[p]].id, b = vertices[path2[p + 1]].id;
      pathEdges2.add(`${a}->${b}`);
      if (!graph.directed) pathEdges2.add(`${b}->${a}`);
    }

    for (let i = 0; i < n; i++) {
      const id = vertices[i].id;
      if (pathSet1.has(i))           vertexStates[id] = 'path';
      else if (pathSet2.has(i))      vertexStates[id] = 'path2';
      else if (i === hK)             vertexStates[id] = 'active';
      else if (i === hI || i === hJ) vertexStates[id] = 'frontier';
      else                           vertexStates[id] = 'unvisited';
    }

    const kId = hK !== null ? vertices[hK]?.id : null;
    const iId = hI !== null ? vertices[hI]?.id : null;
    const jId = hJ !== null ? vertices[hJ]?.id : null;

    for (const edge of graph.edges) {
      const eKey = `${edge.source}->${edge.target}`;
      if (pathEdges1.has(eKey)) {
        edgeStates[edge.id] = 'path';
      } else if (pathEdges2.has(eKey)) {
        edgeStates[edge.id] = 'path2';
      } else if (kId && iId && jId) {
        const isIK = edge.source === iId && edge.target === kId;
        const isKJ = edge.source === kId && edge.target === jId;
        if (!graph.directed) {
          const isKI = edge.source === kId && edge.target === iId;
          const isJK = edge.source === jId && edge.target === kId;
          edgeStates[edge.id] = (isIK || isKJ || isKI || isJK) ? 'traversed' : 'default';
        } else {
          edgeStates[edge.id] = (isIK || isKJ) ? 'traversed' : 'default';
        }
      } else if (kId) {
        edgeStates[edge.id] = (edge.source === kId || edge.target === kId) ? 'traversed' : 'default';
      } else {
        edgeStates[edge.id] = 'default';
      }
    }

    return { vertexStates, edgeStates };
  }

  function makeMeta(
    hI: number | null, hJ: number | null, hK: number | null,
    wValue: number | null, improved: boolean, tied: boolean,
    optimalPaths: string[][], optimalValue: number | null,
    phase: ChoMeta['phase'],
    matrixIndex: number
  ): ChoMeta {
    return {
      matrixSnapshot: snapshot(clone(V)),
      matrixIndex,
      vertexLabels:   labels,
      currentIntermediate: hK !== null ? labels[hK] : null,
      currentI:   hI,
      currentJ:   hJ,
      wValue,
      improved,
      tied,
      optimalPath:  optimalPaths[0] ?? [],
      optimalPaths,
      optimalValue,
      mode,
      phase,
    };
  }

  let idx = 0;

  // ── Étape d'initialisation ────────────────────────────────────────────────
  {
    const { vertexStates, edgeStates } = buildStates(null, null, null, []);
    steps.push({
      stepIndex: idx++,
      description: `Initialisation : construire la matrice D⁰ à partir des arêtes directes (∞ = aucun lien direct).`,
      vertexStates, edgeStates,
      metadata: makeMeta(null, null, null, null, false, false, [], null, 'init', 0) as unknown as Record<string, unknown>,
    });
  }

  // ── Passes de relaxation k = 0 … n-1 ──────────────────────────────────────
  for (let k = 0; k < n; k++) {
    const kLabel = labels[k];

    {
      const { vertexStates, edgeStates } = buildStates(null, null, k, []);
      steps.push({
        stepIndex: idx++,
        description: `Passe k=${k + 1} : permettre le sommet intermédiaire « ${kLabel} ». Calculer W[i][j] = V[i][${kLabel}] + V[${kLabel}][j].`,
        vertexStates, edgeStates,
        metadata: makeMeta(null, null, k, null, false, false, [], null, 'relaxation', k) as unknown as Record<string, unknown>,
      });
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (i === k || j === k) continue;
        if (V[i][k] === EMPTY || V[k][j] === EMPTY) continue;

        const wij     = V[i][k] + V[k][j];
        const improved = betterThan(wij, V[i][j]);
        const tied     = !improved && wij === V[i][j];

        if (improved) {
          V[i][j]       = wij;
          prevAll[i][j] = [k];
        } else if (tied && !prevAll[i][j].includes(k) && prevAll[i][j].length < 2) {
          // Equal cost: record k as an alternative intermediate for this pair
          prevAll[i][j] = [...prevAll[i][j], k];
        }

        const { vertexStates, edgeStates } = buildStates(i, j, k, []);
        steps.push({
          stepIndex: idx++,
          description: improved
            ? `W[${labels[i]}][${labels[j]}] = ${V[i][k]} + ${V[k][j]} = ${wij} → amélioré.`
            : tied
              ? `W[${labels[i]}][${labels[j]}] = ${wij} — égalité ! Chemin alternatif via « ${kLabel} » enregistré.`
              : `W[${labels[i]}][${labels[j]}] = ${wij} — aucune amélioration (actuel : ${displayVal(V[i][j])}).`,
          vertexStates, edgeStates,
          metadata: makeMeta(i, j, k, wij, improved, tied, [], null, 'relaxation', k + 1) as unknown as Record<string, unknown>,
        });
      }
    }

    {
      const { vertexStates, edgeStates } = buildStates(null, null, null, []);
      steps.push({
        stepIndex: idx++,
        description: `Matrice D${k + 1} complète après avoir permis « ${kLabel} » comme intermédiaire.`,
        vertexStates, edgeStates,
        metadata: makeMeta(null, null, null, null, false, false, [], null, 'relaxation', k + 1) as unknown as Record<string, unknown>,
      });
    }
  }

  // ── Reconstruction du chemin ───────────────────────────────────────────────
  let optimalPaths: string[][] = [];
  let optimalValue: number | null = null;
  let rawPaths: number[][] = [];   // all optimal paths as vertex-index arrays (up to 2)

  if (srcIdx !== null && tgtIdx !== null) {
    optimalValue = V[srcIdx][tgtIdx];

    if (optimalValue === EMPTY) {
      const { vertexStates, edgeStates } = buildStates(null, null, null, []);
      steps.push({
        stepIndex: idx++,
        description: `Reconstruction : aucun chemin ${mode === 'min' ? 'le plus court' : 'le plus long'} de « ${labels[srcIdx]} » à « ${labels[tgtIdx]} ».`,
        vertexStates, edgeStates,
        metadata: makeMeta(srcIdx, tgtIdx, null, null, false, false, [], null, 'reconstruction', n) as unknown as Record<string, unknown>,
      });
    } else {
      rawPaths = reconstructAllPaths(prevAll, V, EMPTY, srcIdx, tgtIdx);
      if (rawPaths.length > 0) {
        optimalPaths = rawPaths.map(p => p.map(i => labels[i]));
        const pathsDesc = optimalPaths.map(p => p.join(' → ')).join(' ou ');
        const { vertexStates, edgeStates } = buildStates(null, null, null, rawPaths);
        const plural = rawPaths.length > 1
          ? `${rawPaths.length} chemins optimaux équivalents`
          : `chemin`;
        steps.push({
          stepIndex: idx++,
          description: `Reconstruction : ${plural} ${mode === 'min' ? 'le plus court' : 'le plus long'} de « ${labels[srcIdx]} » à « ${labels[tgtIdx]} » : ${pathsDesc} (total : ${optimalValue}).`,
          vertexStates, edgeStates,
          metadata: makeMeta(srcIdx, tgtIdx, null, null, false, false, optimalPaths, optimalValue, 'reconstruction', n) as unknown as Record<string, unknown>,
        });
      }
    }
  }

  // ── Étape finale ──────────────────────────────────────────────────────────
  {
    const { vertexStates, edgeStates } = buildStates(null, null, null, rawPaths);
    const desc = srcIdx !== null && tgtIdx !== null
      ? optimalPaths.length > 1
        ? `Terminé. ${optimalPaths.length} chemins ${mode === 'min' ? 'les plus courts' : 'les plus longs'} équivalents de « ${labels[srcIdx]} » à « ${labels[tgtIdx]} » (coût : ${optimalValue}).`
        : optimalPaths.length === 1
          ? `Terminé. Chemin ${mode === 'min' ? 'le plus court' : 'le plus long'} : ${optimalPaths[0].join(' → ')} = ${optimalValue}.`
          : `Terminé. Aucun chemin de « ${labels[srcIdx ?? 0]} » à « ${labels[tgtIdx ?? 0]} ».`
      : `Terminé. Matrice des chemins optimaux calculée pour toutes les paires.`;

    steps.push({
      stepIndex: idx++,
      description: desc,
      vertexStates, edgeStates,
      metadata: makeMeta(srcIdx, tgtIdx, null, null, false, false, optimalPaths, optimalValue, 'done', n) as unknown as Record<string, unknown>,
    });
  }

  return steps;
}

export const demoucronChoDef: AlgorithmDef = {
  id: 'demoucron-cho',
  name: 'Demoucron — Chemin Optimal',
  description:
    'Méthode de relaxation matricielle (style Floyd-Warshall) calculant les chemins optimaux ' +
    'entre toutes les paires de sommets d\'un graphe orienté pondéré. ' +
    'À chaque passe k, le sommet xₖ devient un intermédiaire autorisé : ' +
    'V[i][j] = min/max(V[i][j], V[i][k] + V[k][j]).',
  requiresWeights:  true,
  requiresDirected: true,
  inputs: [
    {
      key:      'mode',
      label:    'Maximiser le chemin (le plus long)',
      type:     'boolean',
      required: true,
      default:  false,
    },
    {
      key:      'source',
      label:    'Sommet source (optionnel)',
      type:     'vertex-select',
      required: false,
    },
    {
      key:      'target',
      label:    'Sommet cible (optionnel)',
      type:     'vertex-select',
      required: false,
    },
  ],
  presets: [
    {
      name: 'Réseau de transport (6 nœuds)',
      description: 'Graphe orienté pondéré classique pour la démonstration du chemin le plus court.',
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
      name: 'Chemin le plus long (5 nœuds)',
      description: 'Variante MAX : trouver le chemin avec le poids total le plus élevé.',
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
    {
      name: 'Double solution optimale',
      description: 'S→A→T (3+5=8) et S→B→T (2+6=8) ont le même coût : démontre la détection de solutions multiples.',
      graph: {
        directed: true, weighted: true,
        vertices: [
          { id: 'dv1', label: 'S', x: 80,  y: 200 },
          { id: 'dv2', label: 'A', x: 260, y: 100 },
          { id: 'dv3', label: 'B', x: 260, y: 300 },
          { id: 'dv4', label: 'T', x: 440, y: 200 },
        ],
        edges: [
          { id: 'de1', source: 'dv1', target: 'dv2', weight: 3, directed: true },
          { id: 'de2', source: 'dv1', target: 'dv3', weight: 2, directed: true },
          { id: 'de3', source: 'dv2', target: 'dv4', weight: 5, directed: true },
          { id: 'de4', source: 'dv3', target: 'dv4', weight: 6, directed: true },
        ],
      },
      defaultParams: { mode: false, source: 'dv1', target: 'dv4' },
    },
  ],
  validate(graph) {
    if (graph.vertices.length < 2) return 'Le graphe doit avoir au moins 2 sommets.';
    if (!graph.weighted)           return 'Demoucron Chemin Optimal nécessite un graphe pondéré.';
    if (!graph.directed)           return 'Demoucron Chemin Optimal nécessite un graphe orienté.';
    return null;
  },
  run: runDemoucronCho,
};
