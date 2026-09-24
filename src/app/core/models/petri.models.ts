// ── Modèle de données pour les Réseaux de Petri (RdP) ────────────────────────
// Un RdP est un graphe biparti : places (cercles) ⇄ transitions (barres).
// Les arcs ne relient qu'une place à une transition (PreArc) ou une transition
// à une place (PostArc), jamais place-place ni transition-transition.

export interface Place {
  id: string;
  label: string;       // code court affiché sur le canevas (ex. « P1 »)
  description: string; // signification réelle affichée dans la légende (ex. « Prêt production »)
  x: number;
  y: number;
  marking: number; // marquage initial M0 de la place (édité via le formulaire / clic)
}

export interface Transition {
  id: string;
  label: string;       // code court affiché sur le canevas (ex. « T1 »)
  description: string; // signification réelle affichée dans la légende (ex. « Produire »)
  x: number;
  y: number;
  horizontal?: boolean; // orientation : false/absent = barre verticale, true = horizontale
}

/** PreArc = place → transition (condition de franchissement)
 *  PostArc = transition → place (production de jetons) */
export type ArcKind = 'PreArc' | 'PostArc';

export interface Point {
  x: number;
  y: number;
}

export interface Arc {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number; // RdP généralisé : poids ≥ 1 (défaut 1)
  kind: ArcKind;
  /** Points d'angle intermédiaires : l'arc devient une ligne brisée passant
   *  par ces points. Vide/absent = ligne droite. */
  waypoints?: Point[];
}

/** Annotation texte libre posée sur le canevas (description additionnelle). */
export interface TextNote {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** Forme sérialisable du réseau (export / import JSON). */
export interface PetriNet {
  places: Place[];
  transitions: Transition[];
  arcs: Arc[];
  notes?: TextNote[];
}

export function emptyPetriNet(): PetriNet {
  return { places: [], transitions: [], arcs: [], notes: [] };
}

/** Politique de résolution de conflit lorsque plusieurs transitions sont
 *  franchissables sur le même tick. Choix documenté et sélectionnable dans l'UI. */
export type ConflictPolicy = 'random' | 'priority' | 'parallel';

// ── Séquence manuelle de transitions ─────────────────────────────────────────

/** Catégorie de l'erreur rencontrée lors de l'exécution d'une séquence manuelle. */
export type SequenceErrorKind =
  | 'transition_inconnue'        // le label ne correspond à aucune transition du réseau
  | 'transition_infranchissable' // marquage insuffisant pour franchir la transition
  | 'sequence_vide';             // la séquence parsée ne contient aucun label

/** Détail d'une place bloquante lors d'un échec de franchissement. */
export interface BlockingPlace {
  placeLabel: string;
  available: number;
  required: number;
}

/** Erreur produite lors de l'exécution pas-à-pas d'une séquence manuelle. */
export interface SequenceError {
  kind: SequenceErrorKind;
  /** Label de la transition concernée (non applicable pour sequence_vide). */
  transitionLabel?: string;
  /** Détail des places bloquantes (uniquement pour transition_infranchissable). */
  blockingPlaces?: BlockingPlace[];
}

/** État d'une étape dans la liste de progression visuelle. */
export type SequenceStepState = 'done' | 'active' | 'error' | 'pending';