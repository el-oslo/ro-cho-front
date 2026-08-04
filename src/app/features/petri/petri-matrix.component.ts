import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PetriService } from '../../core/services/petri.service';

/** Affichage en direct des matrices Pré, Post, d'incidence (W = Post − Pré)
 *  et du vecteur de marquage courant. Rangées = places, colonnes = transitions. */
@Component({
  selector: 'app-petri-matrix',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './petri-matrix.component.html',
  styleUrl: './petri-matrix.component.scss',
})
export class PetriMatrixComponent {
  protected petri = inject(PetriService);

  readonly placeLabels = computed(() => this.petri.placeLabels());
  readonly transLabels = computed(() => this.petri.transitionLabels());
  readonly pre = computed(() => this.petri.pre());
  readonly post = computed(() => this.petri.post());
  readonly incidence = computed(() => this.petri.incidence());
  readonly marking = computed(() => this.petri.marking());
  readonly initialMarking = computed(() => this.petri.initialMarking());
  readonly parikh = computed(() => this.petri.parikhVector());

  readonly hasNet = computed(() => this.placeLabels().length > 0 && this.transLabels().length > 0);
}
