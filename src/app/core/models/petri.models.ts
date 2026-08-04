// ── Modèle de données pour les Réseaux de Petri (RdP) ────────────────────────
// Un RdP est un graphe biparti : places (cercles) ⇄ transitions (barres).
// Les arcs ne relient qu'une place à une transition (PreArc) ou une transition
// à une place (PostArc), jamais place-place ni transition-transition.

export interface Place {
  id: string;
  label: string;
  x: number;
  y: number;
  marking: number; // marquage initial M0 de la place (édité via le formulaire / clic)
}

export interface Transition {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** PreArc = place → transition (condition de franchissement)
 *  PostArc = transition → place (production de jetons) */
export type ArcKind = 'PreArc' | 'PostArc';

export interface Arc {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number; // RdP généralisé : poids ≥ 1 (défaut 1)
  kind: ArcKind;
}

/** Forme sérialisable du réseau (export / import JSON). */
export interface PetriNet {
  places: Place[];
  transitions: Transition[];
  arcs: Arc[];
}

export function emptyPetriNet(): PetriNet {
  return { places: [], transitions: [], arcs: [] };
}

/** Politique de résolution de conflit lorsque plusieurs transitions sont
 *  franchissables sur le même tick. Choix documenté et sélectionnable dans l'UI. */
export type ConflictPolicy = 'random' | 'priority' | 'parallel';