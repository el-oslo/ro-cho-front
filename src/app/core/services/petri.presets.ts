import { Arc, PetriNet, Place, Transition } from '../models/petri.models';

export interface PetriPreset {
  name: string;
  description: string;
  net: PetriNet;
}

// Petits helpers de construction (ids lisibles, suffisent comme clés).
const P = (id: string, label: string, description: string, x: number, y: number, marking: number): Place =>
  ({ id, label, description, x, y, marking });
const T = (id: string, label: string, description: string, x: number, y: number): Transition =>
  ({ id, label, description, x, y });
const pre = (place: string, trans: string, weight = 1): Arc =>
  ({ id: `pre_${place}_${trans}`, sourceId: place, targetId: trans, weight, kind: 'PreArc' });
const post = (trans: string, place: string, weight = 1): Arc =>
  ({ id: `post_${trans}_${place}`, sourceId: trans, targetId: place, weight, kind: 'PostArc' });

// ── Producteur / Consommateur avec tampon ────────────────────────────────────
const producerConsumer: PetriNet = {
  places: [
    P('pr', 'P1', 'Prêt production', 120, 120, 1),
    P('pb', 'P2', 'Production en cours', 300, 120, 0),
    P('buf', 'P3', 'Tampon', 480, 220, 0),
    P('cr', 'P4', 'Prêt consommation', 660, 120, 1),
    P('cb', 'P5', 'Consommation en cours', 480, 120, 0),
  ],
  transitions: [
    T('t1', 'T1', 'Produire', 210, 120),
    T('t2', 'T2', 'Déposer', 390, 120),
    T('t3', 'T3', 'Retirer', 660, 220),
    T('t4', 'T4', 'Consommer', 480, 320),
  ],
  arcs: [
    pre('pr', 't1'), post('t1', 'pb'),
    pre('pb', 't2'), post('t2', 'pr'), post('t2', 'buf'),
    pre('cr', 't3'), pre('buf', 't3'), post('t3', 'cb'),
    pre('cb', 't4'), post('t4', 'cr'),
  ],
};

// ── Exclusion mutuelle (deux processus, un sémaphore) ────────────────────────
// Illustre le conflit : T1_entrer et T2_entrer sont franchissables en même
// temps mais se disputent le jeton du sémaphore.
const mutex: PetriNet = {
  places: [
    P('p1', 'P1', 'Processus 1 libre', 120, 100, 1),
    P('c1', 'P2', 'Processus 1 en section critique', 340, 100, 0),
    P('sem', 'P3', 'Sémaphore', 260, 240, 1),
    P('p2', 'P4', 'Processus 2 libre', 120, 380, 1),
    P('c2', 'P5', 'Processus 2 en section critique', 340, 380, 0),
  ],
  transitions: [
    T('t1e', 'T1', 'Processus 1 entre', 230, 100),
    T('t1x', 'T2', 'Processus 1 sort', 460, 100),
    T('t2e', 'T3', 'Processus 2 entre', 230, 380),
    T('t2x', 'T4', 'Processus 2 sort', 460, 380),
  ],
  arcs: [
    pre('p1', 't1e'), pre('sem', 't1e'), post('t1e', 'c1'),
    pre('c1', 't1x'), post('t1x', 'p1'), post('t1x', 'sem'),
    pre('p2', 't2e'), pre('sem', 't2e'), post('t2e', 'c2'),
    pre('c2', 't2x'), post('t2x', 'p2'), post('t2x', 'sem'),
  ],
};

export const PETRI_PRESETS: PetriPreset[] = [
  {
    name: 'Producteur / Consommateur',
    description: 'Un producteur et un consommateur synchronisés par un tampon.',
    net: producerConsumer,
  },
  {
    name: 'Exclusion mutuelle',
    description: 'Deux processus se disputant un sémaphore (illustre les conflits).',
    net: mutex,
  },
];