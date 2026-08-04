import { Component, ElementRef, ViewChild, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PetriService } from '../../core/services/petri.service';
import { ConflictPolicy } from '../../core/models/petri.models';

/** Panneau de contrôle de la simulation RdP :
 *  démarrer/arrêter, vitesse, reset, politique de conflit, formulaire de
 *  marquage initial, injection manuelle, export/import et modèles. */
@Component({
  selector: 'app-petri-controls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './petri-controls.component.html',
  styleUrl: './petri-controls.component.scss',
})
export class PetriControlsComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  protected petri = inject(PetriService);

  readonly places = computed(() => this.petri.places());
  readonly marking = computed(() => this.petri.marking());
  readonly firableCount = computed(() => this.petri.firable().size);

  readonly policies: { value: ConflictPolicy; label: string; hint: string }[] = [
    { value: 'random', label: 'Aléatoire', hint: 'Tire une transition au hasard parmi les franchissables' },
    { value: 'priority', label: 'Priorité (ordre de création)', hint: 'Franchit la plus ancienne transition' },
    { value: 'parallel', label: 'Parallèle', hint: 'Franchit toutes les transitions non conflictuelles' },
  ];

  setInterval(v: string) { this.petri.tickInterval.set(Number(v)); }
  setPolicy(v: string) { this.petri.conflictPolicy.set(v as ConflictPolicy); }

  onMarkingInput(placeId: string, value: string) {
    this.petri.setInitialMarking(placeId, parseInt(value, 10) || 0);
  }

  triggerImport() {
    this.fileInput.nativeElement.value = '';
    this.fileInput.nativeElement.click();
  }
  async onFileSelected(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await this.petri.importJSON(file);
  }

  loadPreset(name: string) {
    if (name) this.petri.loadPreset(name);
  }
}
