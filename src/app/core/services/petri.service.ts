import { Injectable, computed, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  Arc, ArcKind, ConflictPolicy, PetriNet, Place, Point, TextNote, Transition, emptyPetriNet,
} from '../models/petri.models';
import { PETRI_PRESETS } from './petri.presets';

/** Entrée du journal de franchissement (permet de reconstituer le vecteur de Parikh). */
export interface FiringLogEntry {
  transitionId: string;
  timestamp: number;
}

/** Journal séparé des injections manuelles de jetons (événements externes). */
export interface InjectionLogEntry {
  placeId: string;
  amount: number;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class PetriService {
  // ── État du réseau (Signals) ───────────────────────────────────────────────
  readonly places = signal<Place[]>([]);
  readonly transitions = signal<Transition[]>([]);
  readonly arcs = signal<Arc[]>([]);
  readonly notes = signal<TextNote[]>([]);

  // Marquage courant, stocké par id de place pour éviter toute dérive d'index
  // quand on ajoute/supprime des places. Le vecteur aligné est dérivé (marking).
  private readonly markingMap = signal<Record<string, number>>({});

  // Journaux
  readonly firingLog = signal<FiringLogEntry[]>([]);
  readonly injectionLog = signal<InjectionLogEntry[]>([]);

  // ── Paramètres / état de simulation ────────────────────────────────────────
  readonly isRunning = signal(false);
  readonly tickInterval = signal(800);       // ms, réglable via slider (200–3000)
  readonly conflictPolicy = signal<ConflictPolicy>('random');
  readonly deadlock = signal(false);
  /** Dernières transitions franchies — sert au flash d'animation sur le canvas. */
  readonly lastFired = signal<{ ids: string[]; ts: number } | null>(null);
  /** Dernière place ayant reçu une injection manuelle — animation distincte. */
  readonly lastInjected = signal<{ id: string; ts: number } | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private snackBar: MatSnackBar) {}

  // ── Vecteurs dérivés ────────────────────────────────────────────────────────
  /** Vecteur marquage courant aligné sur l'ordre des places. */
  readonly marking = computed<number[]>(() =>
    this.places().map(p => this.markingMap()[p.id] ?? 0),
  );

  /** Marquage initial M0 (champ marking de chaque place). */
  readonly initialMarking = computed<number[]>(() => this.places().map(p => p.marking));

  readonly placeLabels = computed(() => this.places().map(p => p.label));
  readonly transitionLabels = computed(() => this.transitions().map(t => t.label));

  // ── Matrices Pré / Post / Incidence (n places × m transitions) ──────────────
  readonly pre = computed<number[][]>(() => this.buildMatrix('PreArc'));
  readonly post = computed<number[][]>(() => this.buildMatrix('PostArc'));
  readonly incidence = computed<number[][]>(() => {
    const pre = this.pre();
    const post = this.post();
    return post.map((row, i) => row.map((v, j) => v - pre[i][j]));
  });

  private buildMatrix(kind: ArcKind): number[][] {
    const places = this.places();
    const transitions = this.transitions();
    const pIdx = new Map(places.map((p, i) => [p.id, i]));
    const tIdx = new Map(transitions.map((t, j) => [t.id, j]));
    const m = places.map(() => transitions.map(() => 0));
    for (const a of this.arcs()) {
      if (a.kind !== kind) continue;
      // PreArc: place(source) → transition(target) ; PostArc: transition(source) → place(target)
      const placeId = kind === 'PreArc' ? a.sourceId : a.targetId;
      const transId = kind === 'PreArc' ? a.targetId : a.sourceId;
      const i = pIdx.get(placeId);
      const j = tIdx.get(transId);
      if (i !== undefined && j !== undefined) m[i][j] = a.weight;
    }
    return m;
  }

  // ── Franchissabilité ────────────────────────────────────────────────────────
  /** Ensemble des transitions franchissables au marquage courant :
   *  Tⱼ franchissable ⟺ marking[i] ≥ pre[i][j] pour tout i. */
  readonly firable = computed<Set<string>>(() => {
    const m = this.markingMap();
    const arcs = this.arcs();
    const result = new Set<string>();
    for (const t of this.transitions()) {
      const inputs = arcs.filter(a => a.kind === 'PreArc' && a.targetId === t.id);
      if (inputs.every(a => (m[a.sourceId] ?? 0) >= a.weight)) result.add(t.id);
    }
    return result;
  });

  /** Conflit : au moins deux transitions franchissables simultanément. */
  readonly hasConflict = computed(() => this.firable().size > 1);

  /** Vecteur caractéristique / de Parikh de la séquence exécutée. */
  readonly parikhVector = computed<number[]>(() => {
    const counts = new Map<string, number>();
    for (const e of this.firingLog()) counts.set(e.transitionId, (counts.get(e.transitionId) ?? 0) + 1);
    return this.transitions().map(t => counts.get(t.id) ?? 0);
  });

  // ── Boucle de simulation ────────────────────────────────────────────────────
  start() {
    if (this.isRunning()) return;
    this.isRunning.set(true);
    this.scheduleNext();
  }

  stop() {
    this.isRunning.set(false);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  toggleRun() { this.isRunning() ? this.stop() : this.start(); }

  // setTimeout récursif (plutôt que setInterval) pour prendre en compte
  // immédiatement les changements de vitesse du slider.
  private scheduleNext() {
    this.timer = setTimeout(() => {
      if (!this.isRunning()) return;
      this.tick();
      this.scheduleNext();
    }, this.tickInterval());
  }

  /**
   * Un tick de simulation.
   * Résolution de conflit (plusieurs transitions franchissables) — CHOIX RETENU,
   * sélectionnable dans l'UI (conflictPolicy) :
   *   • 'random'   : tirage aléatoire uniforme d'une transition (par défaut)
   *   • 'priority' : la plus ancienne (ordre de création) est franchie
   *   • 'parallel' : franchit toutes les transitions non conflictuelles sur le
   *                  même tick (re-vérification gloutonne pour ne jamais épuiser
   *                  une place partagée par deux transitions concurrentes)
   * Si aucune transition n'est franchissable : état « blocage » (deadlock),
   * la boucle continue (une injection manuelle peut débloquer la situation).
   */
  tick() {
    const firable = this.firable();
    if (firable.size === 0) { this.deadlock.set(true); return; }
    this.deadlock.set(false);

    const candidates = this.transitions().filter(t => firable.has(t.id)).map(t => t.id);
    const policy = this.conflictPolicy();

    if (policy === 'parallel') {
      const fired: string[] = [];
      // On rejoue la franchissabilité contre le marquage en cours de mise à jour
      // afin de ne jamais retirer plus de jetons qu'une place n'en possède.
      for (const id of candidates) {
        if (this.canFire(id)) { this.applyFiring(id); fired.push(id); }
      }
      if (fired.length) this.lastFired.set({ ids: fired, ts: Date.now() });
    } else {
      const chosen = policy === 'random'
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : candidates[0]; // priority = ordre de création
      this.applyFiring(chosen);
      this.lastFired.set({ ids: [chosen], ts: Date.now() });
    }
  }

  /** Franchit manuellement une transition (clic utilisateur), si franchissable. */
  fireManually(transitionId: string): boolean {
    if (!this.canFire(transitionId)) return false;
    this.applyFiring(transitionId);
    this.lastFired.set({ ids: [transitionId], ts: Date.now() });
    this.deadlock.set(false);
    return true;
  }

  private canFire(transitionId: string): boolean {
    const m = this.markingMap();
    return this.arcs()
      .filter(a => a.kind === 'PreArc' && a.targetId === transitionId)
      .every(a => (m[a.sourceId] ?? 0) >= a.weight);
  }

  /** marking' = marking − Pré[:,j] + Post[:,j] = marking + incidence[:,j] */
  private applyFiring(transitionId: string) {
    const arcs = this.arcs();
    this.markingMap.update(map => {
      const next = { ...map };
      for (const a of arcs) {
        if (a.kind === 'PreArc' && a.targetId === transitionId) {
          next[a.sourceId] = (next[a.sourceId] ?? 0) - a.weight;
        } else if (a.kind === 'PostArc' && a.sourceId === transitionId) {
          next[a.targetId] = (next[a.targetId] ?? 0) + a.weight;
        }
      }
      return next;
    });
    this.firingLog.update(log => [...log, { transitionId, timestamp: Date.now() }]);
  }

  // ── Injection manuelle de jetons (événement externe) ────────────────────────
  /** Injecte directement des jetons dans une place, hors règles de franchissement.
   *  Journalisé séparément (injectionLog), jamais dans firingLog. */
  injectToken(placeId: string, amount = 1) {
    this.markingMap.update(map => ({
      ...map,
      [placeId]: Math.max(0, (map[placeId] ?? 0) + amount),
    }));
    this.injectionLog.update(log => [...log, { placeId, amount, timestamp: Date.now() }]);
    this.lastInjected.set({ id: placeId, ts: Date.now() });
    this.deadlock.set(false);
  }

  // ── Édition du réseau ────────────────────────────────────────────────────────
  private nextLabel(prefix: 'P' | 'T', existing: string[]): string {
    const used = new Set(existing);
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  addPlace(pos: { x: number; y: number }): Place {
    const place: Place = {
      id: crypto.randomUUID(),
      label: this.nextLabel('P', this.places().map(p => p.label)),
      description: '',
      x: pos.x, y: pos.y, marking: 0,
    };
    this.places.update(ps => [...ps, place]);
    this.markingMap.update(m => ({ ...m, [place.id]: 0 }));
    return place;
  }

  addTransition(pos: { x: number; y: number }): Transition {
    const t: Transition = {
      id: crypto.randomUUID(),
      label: this.nextLabel('T', this.transitions().map(x => x.label)),
      description: '',
      x: pos.x, y: pos.y,
    };
    this.transitions.update(ts => [...ts, t]);
    return t;
  }

  /** Valide et crée un arc. Retourne null si la liaison est illégale
   *  (place-place, transition-transition, doublon, ou nœud inconnu). */
  addArc(sourceId: string, targetId: string, weight = 1): Arc | null {
    if (sourceId === targetId) return null;
    const isPlace = (id: string) => this.places().some(p => p.id === id);
    const isTrans = (id: string) => this.transitions().some(t => t.id === id);

    let kind: ArcKind;
    if (isPlace(sourceId) && isTrans(targetId)) kind = 'PreArc';
    else if (isTrans(sourceId) && isPlace(targetId)) kind = 'PostArc';
    else return null; // place↔place ou transition↔transition interdit

    const dup = this.arcs().some(a => a.sourceId === sourceId && a.targetId === targetId);
    if (dup) return null;

    const arc: Arc = { id: crypto.randomUUID(), sourceId, targetId, weight: Math.max(1, weight), kind };
    this.arcs.update(as => [...as, arc]);
    return arc;
  }

  removeArc(id: string) {
    this.arcs.update(as => as.filter(a => a.id !== id));
  }

  setArcWeight(id: string, weight: number) {
    const w = Math.max(1, Math.round(weight));
    this.arcs.update(as => as.map(a => (a.id === id ? { ...a, weight: w } : a)));
  }

  // ── Points d'angle des arcs ──────────────────────────────────────────────────
  /** Insère un point d'angle à la position `index` de la ligne brisée. */
  addArcWaypoint(arcId: string, index: number, point: Point) {
    this.arcs.update(as => as.map(a => {
      if (a.id !== arcId) return a;
      const wps = [...(a.waypoints ?? [])];
      wps.splice(Math.max(0, Math.min(index, wps.length)), 0, point);
      return { ...a, waypoints: wps };
    }));
  }

  updateArcWaypoint(arcId: string, index: number, point: Point) {
    this.arcs.update(as => as.map(a => {
      if (a.id !== arcId || !a.waypoints) return a;
      const wps = a.waypoints.map((w, i) => (i === index ? point : w));
      return { ...a, waypoints: wps };
    }));
  }

  removeArcWaypoint(arcId: string, index: number) {
    this.arcs.update(as => as.map(a => {
      if (a.id !== arcId || !a.waypoints) return a;
      const wps = a.waypoints.filter((_, i) => i !== index);
      return { ...a, waypoints: wps };
    }));
  }

  /** Rétablit la ligne droite (supprime tous les points d'angle). */
  clearArcWaypoints(arcId: string) {
    this.arcs.update(as => as.map(a => (a.id === arcId ? { ...a, waypoints: [] } : a)));
  }

  // ── Annotations texte ────────────────────────────────────────────────────────
  addNote(pos: { x: number; y: number }, text = ''): TextNote {
    const note: TextNote = { id: crypto.randomUUID(), x: pos.x, y: pos.y, text };
    this.notes.update(ns => [...ns, note]);
    return note;
  }

  updateNoteText(id: string, text: string) {
    this.notes.update(ns => ns.map(n => (n.id === id ? { ...n, text } : n)));
  }

  updateNotePosition(id: string, x: number, y: number) {
    this.notes.update(ns => ns.map(n => (n.id === id ? { ...n, x, y } : n)));
  }

  removeNote(id: string) {
    this.notes.update(ns => ns.filter(n => n.id !== id));
  }

  removeNode(id: string) {
    this.places.update(ps => ps.filter(p => p.id !== id));
    this.transitions.update(ts => ts.filter(t => t.id !== id));
    this.arcs.update(as => as.filter(a => a.sourceId !== id && a.targetId !== id));
    this.markingMap.update(m => {
      const { [id]: _removed, ...rest } = m;
      return rest;
    });
  }

  updatePosition(id: string, x: number, y: number) {
    this.places.update(ps => ps.map(p => (p.id === id ? { ...p, x, y } : p)));
    this.transitions.update(ts => ts.map(t => (t.id === id ? { ...t, x, y } : t)));
  }

  renameNode(id: string, label: string) {
    this.places.update(ps => ps.map(p => (p.id === id ? { ...p, label } : p)));
    this.transitions.update(ts => ts.map(t => (t.id === id ? { ...t, label } : t)));
  }

  /** Définit la signification (description) d'une place ou d'une transition. */
  setNodeDescription(id: string, description: string) {
    this.places.update(ps => ps.map(p => (p.id === id ? { ...p, description } : p)));
    this.transitions.update(ts => ts.map(t => (t.id === id ? { ...t, description } : t)));
  }

  /** Définit le marquage initial M0 d'une place (formulaire / clic) et
   *  synchronise le marquage courant sur cette valeur. */
  setInitialMarking(placeId: string, value: number) {
    const n = Math.max(0, Math.round(value));
    this.places.update(ps => ps.map(p => (p.id === placeId ? { ...p, marking: n } : p)));
    this.markingMap.update(m => ({ ...m, [placeId]: n }));
  }

  isPlace(id: string): boolean { return this.places().some(p => p.id === id); }
  isTransition(id: string): boolean { return this.transitions().some(t => t.id === id); }

  // ── Reset / chargement ───────────────────────────────────────────────────────
  /** Retour au marquage initial M0 ; réinitialise journaux et blocage. */
  reset() {
    const map: Record<string, number> = {};
    for (const p of this.places()) map[p.id] = p.marking;
    this.markingMap.set(map);
    this.firingLog.set([]);
    this.injectionLog.set([]);
    this.deadlock.set(false);
    this.lastFired.set(null);
    this.lastInjected.set(null);
  }

  /** Efface entièrement le réseau. */
  clear() {
    this.stop();
    this.places.set([]);
    this.transitions.set([]);
    this.arcs.set([]);
    this.notes.set([]);
    this.markingMap.set({});
    this.firingLog.set([]);
    this.injectionLog.set([]);
    this.deadlock.set(false);
  }

  loadNet(net: PetriNet) {
    this.stop();
    this.places.set(net.places.map(p => ({ ...p, description: p.description ?? '' })));
    this.transitions.set(net.transitions.map(t => ({ ...t, description: t.description ?? '' })));
    this.arcs.set(net.arcs.map(a => ({ ...a, waypoints: a.waypoints ? [...a.waypoints] : [] })));
    this.notes.set((net.notes ?? []).map(n => ({ ...n })));
    const map: Record<string, number> = {};
    for (const p of net.places) map[p.id] = p.marking;
    this.markingMap.set(map);
    this.firingLog.set([]);
    this.injectionLog.set([]);
    this.deadlock.set(false);
    this.lastFired.set(null);
    this.lastInjected.set(null);
  }

  snapshot(): PetriNet {
    return {
      places: this.places().map(p => ({ ...p })),
      transitions: this.transitions().map(t => ({ ...t })),
      arcs: this.arcs().map(a => ({ ...a, waypoints: a.waypoints ? [...a.waypoints] : [] })),
      notes: this.notes().map(n => ({ ...n })),
    };
  }

  readonly presets = PETRI_PRESETS;

  loadPreset(name: string) {
    const preset = PETRI_PRESETS.find(p => p.name === name);
    if (preset) {
      this.loadNet(preset.net);
      this.snackBar.open(`Réseau chargé : ${preset.name}`, 'OK', { duration: 2500 });
    }
  }

  // ── Import / Export JSON ─────────────────────────────────────────────────────
  exportJSON() {
    const json = JSON.stringify(this.snapshot(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'petri-net.json';
    a.click();
    URL.revokeObjectURL(url);
    this.snackBar.open('Réseau exporté (petri-net.json)', 'OK', { duration: 2500 });
  }

  async importJSON(file: File): Promise<void> {
    try {
      const parsed = JSON.parse(await file.text());
      if (
        !Array.isArray(parsed.places) ||
        !Array.isArray(parsed.transitions) ||
        !Array.isArray(parsed.arcs)
      ) {
        throw new Error('Invalid shape');
      }
      this.loadNet(parsed as PetriNet);
      this.snackBar.open('Réseau importé avec succès', 'OK', { duration: 2500 });
    } catch {
      this.snackBar.open('Import échoué : JSON invalide', 'Fermer', { duration: 4000 });
    }
  }
}