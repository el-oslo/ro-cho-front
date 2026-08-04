import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PetriService } from '../../core/services/petri.service';

/** Légende éditable superposée au canevas : liste les places et les transitions
 *  et permet de les renommer (et d'ajuster le marquage initial des places)
 *  directement, sans passer par le canevas. */
@Component({
  selector: 'app-petri-legend',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './petri-legend.component.html',
  styleUrl: './petri-legend.component.scss',
})
export class PetriLegendComponent {
  protected petri = inject(PetriService);

  readonly collapsed = signal(false);

  readonly places = computed(() => this.petri.places());
  readonly transitions = computed(() => this.petri.transitions());
  readonly marking = computed(() => this.petri.marking());

  rename(id: string, label: string) {
    const trimmed = label.trim();
    if (trimmed) this.petri.renameNode(id, trimmed);
  }

  setDescription(id: string, description: string) {
    this.petri.setNodeDescription(id, description.trim());
  }

  setMarking(placeId: string, value: string) {
    this.petri.setInitialMarking(placeId, parseInt(value, 10) || 0);
  }

  remove(id: string) {
    this.petri.removeNode(id);
  }

  markingOf(placeId: string): number {
    const idx = this.places().findIndex(p => p.id === placeId);
    return idx >= 0 ? (this.marking()[idx] ?? 0) : 0;
  }
}
