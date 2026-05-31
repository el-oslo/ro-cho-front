/**
 * Algorithme de Demoucron — Chemin Optimal
 *
 * Méthode matricielle déterminant progressivement les chemins optimaux
 * (minimaux ou maximaux) dans un graphe orienté pondéré.
 *
 * Compatible avec l'interface AlgorithmDef de GraphViz.
 */

import { AlgorithmDef, AlgorithmStep, VertexState, EdgeState } from '../models/algorithm.models';
import { Graph, Edge } from '../models/graph.models';

// ---------------------------------------------------------------------------
// Types internes
// ---------------------------------------------------------------------------

const INF  =  Infinity;
const NINF = -Infinity;

type Matrix   = number[][];
type PrevMatrix = (number | null)[][];  // sommet intermédiaire ayant amélioré [i][j]

interface DemoucronMetadata {
  /** Matrice des valeurs optimales courantes (valeurs affichables) */
  matrixSnapshot: (number | string)[][];
  /** Sommet intermédiaire k traité à cette étape (label) */
  currentIntermediate: string | null;
  /** Indice i du couple source évalué à cette sous-étape */
  currentI: number | null;
  /** Indice j du couple cible évalué à cette sous-étape */
  currentJ: number | null;
  /** Valeur W calculée pour (i, j) via k */
  wValue: number | null;
  /** Indique si la case (i,j) a été améliorée à cette sous-étape */
  improved: boolean;
  /** Chemin optimal reconstruit (labels des sommets), disponible à la fin */
  optimalPath: string[];
  /** Valeur totale du chemin optimal, disponible à la fin */
  optimalValue: number | null;
  /** Labels des sommets dans l'ordre de la matrice */
  vertexLabels: string[];
  /** Mode de l'algorithme */
  mode: 'min' | 'max';
  /** Phase courante */
  phase: 'init' | 'relaxation' | 'reconstruction' | 'done';
}

// ---------------------------------------------------------------------------
// Fonctions utilitaires
// ---------------------------------------------------------------------------

/** Convertit une valeur numérique en chaîne lisible pour l'affichage */
function displayValue(v: number, mode: 'min' | 'max'): string {
  if (v === INF)  return mode === 'min' ? '∞'  : '-∞';
  if (v === NINF) return mode === 'min' ? '-∞' : '∞';
  return String(v);
}

/** Crée une copie profonde d'une matrice numérique */
function cloneMatrix(m: Matrix): Matrix {
  return m.map(row => [...row]);
}

/** Crée un snapshot lisible de la matrice pour l'affichage */
function matrixSnapshot(m: Matrix, mode: 'min' | 'max'): (number | string)[][] {
  return m.map(row =>
    row.map(v => (v === INF || v === NINF) ? displayValue(v, mode) : v)
  );
}

/**
 * Reconstruit le chemin optimal entre les indices src et tgt
 * en suivant récursivement la matrice prev.
 * Retourne la liste des indices de sommets (inclus src et tgt).
 */
function reconstructPath(
  prev: PrevMatrix,
  src: number,
  tgt: number
): number[] | null {
  if (src === tgt) return [src];

  const intermediate = prev[src][tgt];
  if (intermediate === null) {
    // Pas de chemin (valeur initiale jamais améliorée — arc direct ou inexistant)
    return null;
  }

  // L'amélioration est passée par `intermediate` :
  // chemin = path(src → intermediate) + path(intermediate → tgt)
  const left  = reconstructPath(prev, src, intermediate);
  const right = reconstructPath(prev, intermediate, tgt);

  if (left === null || right === null) return null;

  // Éviter la duplication du sommet intermédiaire
  return [...left, ...right.slice(1)];
}

// ---------------------------------------------------------------------------
// Fonction principale run()
// ---------------------------------------------------------------------------

function run(
  graph: Graph,
  params: Record<string, unknown>
): AlgorithmStep[] {
  const steps: AlgorithmStep[] = [];
  const vertices = graph.vertices;
  const n = vertices.length;

  if (n === 0) return steps;

  const mode        = (params['mode'] as 'min' | 'max') ?? 'min';
  const sourceId    = params['source'] as string | undefined;
  const targetId    = params['target'] as string | undefined;
  const EMPTY       = mode === 'min' ? INF : NINF;
  const betterThan  = mode === 'min'
    ? (a: number, b: number) => a < b
    : (a: number, b: number) => a > b;

  // Index de chaque sommet dans la matrice
  const idToIdx = new Map<string, number>(vertices.map((v, i) => [v.id, i]));
  const labels  = vertices.map(v => v.label);

  const srcIdx = sourceId !== undefined ? (idToIdx.get(sourceId) ?? null) : null;
  const tgtIdx = targetId !== undefined ? (idToIdx.get(targetId) ?? null) : null;

  // ------------------------------------------------------------------
  // Étape 0 — Construction de la matrice initiale D¹
  // ------------------------------------------------------------------
  const V: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : EMPTY))
  );
  const prev: PrevMatrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => null)
  );

  // Remplissage avec les arcs directs
  for (const edge of graph.edges) {
    const i = idToIdx.get(edge.source);
    const j = idToIdx.get(edge.target);
    if (i === undefined || j === undefined) continue;
    const w = edge.weight ?? 1;
    if (betterThan(w, V[i][j])) {
      V[i][j] = w;
      // Pas de sommet intermédiaire pour un arc direct → prev reste null
    }
    // Pour un graphe non orienté, symétrie
    if (!graph.directed) {
      if (betterThan(w, V[j][i])) {
        V[j][i] = w;
      }
    }
  }

  // Construire des Maps d'accès rapide aux edges
  const edgeMap = new Map<string, Edge>();
  for (const e of graph.edges) {
    edgeMap.set(`${e.source}->${e.target}`, e);
    if (!graph.directed) edgeMap.set(`${e.target}->${e.source}`, e);
  }

  /** Construit les états des sommets/arêtes pour un step */
  function buildStates(
    highlightI: number | null,
    highlightJ: number | null,
    highlightK: number | null,
    pathIndices: number[],
    finalDone: boolean
  ): { vertexStates: Record<string, VertexState>; edgeStates: Record<string, EdgeState> } {
    const vertexStates: Record<string, VertexState> = {};
    const edgeStates:   Record<string, EdgeState>   = {};

    const pathSet   = new Set(pathIndices);
    const pathEdges = new Set<string>();
    for (let p = 0; p < pathIndices.length - 1; p++) {
      const a = vertices[pathIndices[p]].id;
      const b = vertices[pathIndices[p + 1]].id;
      pathEdges.add(`${a}->${b}`);
      if (!graph.directed) pathEdges.add(`${b}->${a}`);
    }

    for (let i = 0; i < n; i++) {
      const id = vertices[i].id;
      if (finalDone && pathSet.has(i)) {
        vertexStates[id] = 'path';
      } else if (i === highlightK) {
        vertexStates[id] = 'active';
      } else if (i === highlightI || i === highlightJ) {
        vertexStates[id] = 'frontier';
      } else {
        vertexStates[id] = 'unvisited';
      }
    }

    for (const edge of graph.edges) {
      const key = `${edge.source}->${edge.target}`;
      if (finalDone && pathEdges.has(key)) {
        edgeStates[edge.id] = 'path';
      } else {
        edgeStates[edge.id] = 'default';
      }
    }

    return { vertexStates, edgeStates };
  }

  let stepIndex = 0;

  // Step initial — présentation de la matrice D¹
  {
    const { vertexStates, edgeStates } = buildStates(null, null, null, [], false);
    steps.push({
      stepIndex: stepIndex++,
      description: `Initialisation : construction de la matrice initiale D¹ avec les arcs directs du graphe (∞ = absence de liaison).`,
      vertexStates,
      edgeStates,
      metadata: {
        matrixSnapshot:      matrixSnapshot(V, mode),
        currentIntermediate: null,
        currentI:            null,
        currentJ:            null,
        wValue:              null,
        improved:            false,
        optimalPath:         [],
        optimalValue:        null,
        vertexLabels:        labels,
        mode,
        phase:               'init',
      } satisfies DemoucronMetadata,
    });
  }

  // ------------------------------------------------------------------
  // Étapes de relaxation : k = 0 … n-1 (sommets intermédiaires)
  // ------------------------------------------------------------------
  for (let k = 0; k < n; k++) {
    const kLabel = labels[k];

    // Annoncer le début du traitement du sommet k
    {
      const { vertexStates, edgeStates } = buildStates(null, null, k, [], false);
      steps.push({
        stepIndex: stepIndex++,
        description: `Étape k=${k + 1} : autorisation du sommet intermédiaire « ${kLabel} ». Calcul de W[i][j] = V[i][${kLabel}] + V[${kLabel}][j] pour tous les couples (i, j).`,
        vertexStates,
        edgeStates,
        metadata: {
          matrixSnapshot:      matrixSnapshot(V, mode),
          currentIntermediate: kLabel,
          currentI:            null,
          currentJ:            null,
          wValue:              null,
          improved:            false,
          optimalPath:         [],
          optimalValue:        null,
          vertexLabels:        labels,
          mode,
          phase:               'relaxation',
        } satisfies DemoucronMetadata,
      });
    }

    // Relaxation de tous les couples (i, j) via k
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (V[i][k] === EMPTY || V[k][j] === EMPTY) continue; // chemin inexistant

        const wij = V[i][k] + V[k][j];
        const improved = betterThan(wij, V[i][j]);

        if (improved) {
          V[i][j]    = wij;
          prev[i][j] = k;
        }

        // Un step par couple (i, j) amélioré ou non
        const { vertexStates, edgeStates } = buildStates(i, j, k, [], false);
        steps.push({
          stepIndex: stepIndex++,
          description: improved
            ? `W[${labels[i]}][${labels[j]}] = V[${labels[i]}][${kLabel}] + V[${kLabel}][${labels[j]}] = ${V[i][k]} + ${V[k][j]} = ${wij} → amélioration (ancienne valeur remplacée).`
            : `W[${labels[i]}][${labels[j]}] = ${wij} — pas d'amélioration (valeur actuelle : ${displayValue(V[i][j], mode)}).`,
          vertexStates,
          edgeStates,
          metadata: {
            matrixSnapshot:      matrixSnapshot(V, mode),
            currentIntermediate: kLabel,
            currentI:            i,
            currentJ:            j,
            wValue:              wij,
            improved,
            optimalPath:         [],
            optimalValue:        null,
            vertexLabels:        labels,
            mode,
            phase:               'relaxation',
          } satisfies DemoucronMetadata,
        });
      }
    }

    // Step de synthèse après le traitement de k (matrice Dₖ complète)
    {
      const { vertexStates, edgeStates } = buildStates(null, null, null, [], false);
      steps.push({
        stepIndex: stepIndex++,
        description: `Matrice D${k + 1} construite après autorisation du sommet « ${kLabel} ». Passage au sommet intermédiaire suivant.`,
        vertexStates,
        edgeStates,
        metadata: {
          matrixSnapshot:      matrixSnapshot(V, mode),
          currentIntermediate: kLabel,
          currentI:            null,
          currentJ:            null,
          wValue:              null,
          improved:            false,
          optimalPath:         [],
          optimalValue:        null,
          vertexLabels:        labels,
          mode,
          phase:               'relaxation',
        } satisfies DemoucronMetadata,
      });
    }
  }

  // ------------------------------------------------------------------
  // Reconstruction du chemin (si source et target fournis)
  // ------------------------------------------------------------------
  let optimalPath: string[]  = [];
  let optimalValue: number | null = null;
  let pathIndices: number[]  = [];

  if (srcIdx !== null && tgtIdx !== null) {
    optimalValue = V[srcIdx][tgtIdx];

    if (optimalValue === EMPTY) {
      // Aucun chemin
      const { vertexStates, edgeStates } = buildStates(null, null, null, [], false);
      steps.push({
        stepIndex: stepIndex++,
        description: `Reconstruction : aucun chemin ${mode === 'min' ? 'minimal' : 'maximal'} n'existe entre « ${labels[srcIdx]} » et « ${labels[tgtIdx]} ».`,
        vertexStates,
        edgeStates,
        metadata: {
          matrixSnapshot:  matrixSnapshot(V, mode),
          currentIntermediate: null,
          currentI:        srcIdx,
          currentJ:        tgtIdx,
          wValue:          null,
          improved:        false,
          optimalPath:     [],
          optimalValue:    null,
          vertexLabels:    labels,
          mode,
          phase:           'reconstruction',
        } satisfies DemoucronMetadata,
      });
    } else {
      // Reconstruction récursive via prev
      const rawPath = reconstructPath(prev, srcIdx, tgtIdx);

      if (rawPath) {
        pathIndices = rawPath;
        optimalPath = rawPath.map(idx => labels[idx]);

        const { vertexStates, edgeStates } = buildStates(null, null, null, pathIndices, true);
        steps.push({
          stepIndex: stepIndex++,
          description: `Reconstruction du chemin ${mode === 'min' ? 'le plus court' : 'le plus long'} entre « ${labels[srcIdx]} » et « ${labels[tgtIdx]} » : ${optimalPath.join(' → ')} (valeur totale : ${optimalValue}).`,
          vertexStates,
          edgeStates,
          metadata: {
            matrixSnapshot:  matrixSnapshot(V, mode),
            currentIntermediate: null,
            currentI:        srcIdx,
            currentJ:        tgtIdx,
            wValue:          null,
            improved:        false,
            optimalPath,
            optimalValue,
            vertexLabels:    labels,
            mode,
            phase:           'reconstruction',
          } satisfies DemoucronMetadata,
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Step final — résultat complet
  // ------------------------------------------------------------------
  {
    const { vertexStates, edgeStates } = buildStates(null, null, null, pathIndices, true);
    const finalDesc = srcIdx !== null && tgtIdx !== null
      ? optimalPath.length > 0
          ? `Résultat final : chemin ${mode === 'min' ? 'optimal (min)' : 'optimal (max)'} = ${optimalPath.join(' → ')}, valeur = ${optimalValue}.`
          : `Résultat final : aucun chemin entre « ${labels[srcIdx ?? 0]} » et « ${labels[tgtIdx ?? 0]} ».`
      : `Résultat final : matrice des chemins optimaux entre tous les couples de sommets.`;

    steps.push({
      stepIndex: stepIndex++,
      description: finalDesc,
      vertexStates,
      edgeStates,
      metadata: {
        matrixSnapshot:  matrixSnapshot(V, mode),
        currentIntermediate: null,
        currentI:        srcIdx,
        currentJ:        tgtIdx,
        wValue:          null,
        improved:        false,
        optimalPath,
        optimalValue,
        vertexLabels:    labels,
        mode,
        phase:           'done',
      } satisfies DemoucronMetadata,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(graph: Graph): string | null {
  if (graph.vertices.length < 2) {
    return 'Le graphe doit contenir au moins 2 sommets.';
  }
  if (!graph.weighted) {
    return 'L\'algorithme de Demoucron requiert un graphe pondéré.';
  }
  if (!graph.directed) {
    return 'L\'algorithme de Demoucron est conçu pour un graphe orienté.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS = [
  {
    name: 'Réseau de transport (6 sommets)',
    description: 'Graphe orienté pondéré classique pour illustrer le chemin le plus court.',
    defaultParams: { mode: 'min' },
    graph: {
      directed: true,
      weighted: true,
      vertices: [
        { id: 'v1', label: 'A', x: 100, y: 200 },
        { id: 'v2', label: 'B', x: 250, y: 100 },
        { id: 'v3', label: 'C', x: 250, y: 300 },
        { id: 'v4', label: 'D', x: 400, y: 100 },
        { id: 'v5', label: 'E', x: 400, y: 300 },
        { id: 'v6', label: 'F', x: 550, y: 200 },
      ],
      edges: [
        { id: 'e1',  source: 'v1', target: 'v2', weight: 7,  directed: true },
        { id: 'e2',  source: 'v1', target: 'v3', weight: 9,  directed: true },
        { id: 'e3',  source: 'v2', target: 'v4', weight: 10, directed: true },
        { id: 'e4',  source: 'v2', target: 'v3', weight: 2,  directed: true },
        { id: 'e5',  source: 'v3', target: 'v5', weight: 11, directed: true },
        { id: 'e6',  source: 'v4', target: 'v6', weight: 4,  directed: true },
        { id: 'e7',  source: 'v5', target: 'v4', weight: 1,  directed: true },
        { id: 'e8',  source: 'v5', target: 'v6', weight: 7,  directed: true },
      ],
    },
  },
  {
    name: 'Chemin maximal (5 sommets)',
    description: 'Illustre la variante MAX : trouver le chemin de valeur totale maximale.',
    defaultParams: { mode: 'max' },
    graph: {
      directed: true,
      weighted: true,
      vertices: [
        { id: 'v1', label: 'S', x: 80,  y: 200 },
        { id: 'v2', label: 'B', x: 230, y: 100 },
        { id: 'v3', label: 'C', x: 230, y: 300 },
        { id: 'v4', label: 'D', x: 380, y: 200 },
        { id: 'v5', label: 'T', x: 530, y: 200 },
      ],
      edges: [
        { id: 'e1', source: 'v1', target: 'v2', weight: 3,  directed: true },
        { id: 'e2', source: 'v1', target: 'v3', weight: 5,  directed: true },
        { id: 'e3', source: 'v2', target: 'v4', weight: 6,  directed: true },
        { id: 'e4', source: 'v3', target: 'v4', weight: 4,  directed: true },
        { id: 'e5', source: 'v3', target: 'v5', weight: 2,  directed: true },
        { id: 'e6', source: 'v4', target: 'v5', weight: 8,  directed: true },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Export de l'AlgorithmDef
// ---------------------------------------------------------------------------

export const demoucronCho: AlgorithmDef = {
  id: 'demoucron-cho',
  name: 'Demoucron — Chemin Optimal',
  description:
    'Méthode matricielle calculant progressivement les chemins optimaux (min ou max) ' +
    'entre tous les couples de sommets d\'un graphe orienté pondéré. ' +
    'À chaque étape k, le sommet xₖ devient autorisé comme intermédiaire : ' +
    'V[i][j] = min/max(V[i][j], V[i][k] + V[k][j]).',
  requiresWeights:  true,
  requiresDirected: true,
  inputs: [
    {
      key:      'mode',
      label:    'Objectif',
      type:     'boolean',   // false = min, true = max  (remplacé par select ci-dessous si besoin)
      required: true,
      default:  false,
      // Note : pour un vrai mat-select 'min'/'max', changer type en 'select'
      // et adapter le composant de formulaire en conséquence.
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
  presets: PRESETS,
  validate,
  run,
};