import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PetriService } from '../../core/services/petri.service';

/** Affichage ET édition des matrices Pré, Post, d'incidence (W = Post − Pré),
 *  du marquage initial M0 et du marquage courant. Éditer Pré / Post / M0 génère
 *  directement le modèle de RdP (arcs et jetons). Rangées = places, colonnes = transitions. */
@Component({
  selector: 'app-petri-matrix',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './petri-matrix.component.html',
  styleUrl: './petri-matrix.component.scss',
})
export class PetriMatrixComponent {
  protected petri = inject(PetriService);

  readonly places = computed(() => this.petri.places());
  readonly transitions = computed(() => this.petri.transitions());
  readonly pre = computed(() => this.petri.pre());
  readonly post = computed(() => this.petri.post());
  readonly incidence = computed(() => this.petri.incidence());
  readonly marking = computed(() => this.petri.marking());
  readonly initialMarking = computed(() => this.petri.initialMarking());
  readonly parikh = computed(() => this.petri.parikhVector());

  readonly hasNet = computed(() => this.places().length > 0 && this.transitions().length > 0);

  // ── Ajout de lignes (places) / colonnes (transitions) ────────────────────────
  addPlace() {
    const n = this.places().length;
    this.petri.addPlace({ x: 110, y: 110 + n * 72 });
  }
  addTransition() {
    const m = this.transitions().length;
    this.petri.addTransition({ x: 360, y: 110 + m * 72 });
  }

  // ── Édition des libellés / suppression ───────────────────────────────────────
  rename(id: string, label: string) {
    const trimmed = label.trim();
    if (trimmed) this.petri.renameNode(id, trimmed);
  }
  remove(id: string) { this.petri.removeNode(id); }

  // ── Édition des cellules → génération du modèle ──────────────────────────────
  private toInt(v: string): number { return parseInt(v, 10) || 0; }

  setPre(placeId: string, transId: string, v: string) {
    this.petri.setPre(placeId, transId, this.toInt(v));
  }
  setPost(placeId: string, transId: string, v: string) {
    this.petri.setPost(transId, placeId, this.toInt(v));
  }
  setM0(placeId: string, v: string) {
    this.petri.setInitialMarking(placeId, this.toInt(v));
  }
}
