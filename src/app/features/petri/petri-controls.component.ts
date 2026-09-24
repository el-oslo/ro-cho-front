import { Component, ElementRef, ViewChild, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PetriService } from '../../core/services/petri.service';
import { ConflictPolicy, SequenceStepState } from '../../core/models/petri.models';

/** Panneau de contrôle de la simulation RdP :\
 *  démarrer/arrêter, vitesse, reset, politique de conflit, formulaire de
 *  marquage initial, injection manuelle, export/import, modèles et
 *  séquence manuelle de transitions. */
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

  // ── Séquence manuelle ───────────────────────────────────────────────────────

  /** Texte de la zone de saisie, synchronisé avec le signal du service. */
  get sequenceInputValue(): string { return this.petri.sequenceInput(); }
  set sequenceInputValue(v: string) { this.petri.sequenceInput.set(v); }

  /** Vrai quand la séquence a été parsée et contient au moins un pas. */
  readonly sequenceParsed = computed(() => this.petri.sequenceSteps().length > 0);

  /** Vrai quand le curseur a atteint la fin de la séquence (succès complet). */
  readonly sequenceFinished = computed(() =>
    this.petri.sequenceSteps().length > 0 &&
    this.petri.sequenceCursor() >= this.petri.sequenceSteps().length &&
    !this.petri.sequenceError()
  );

  /** État de chaque étape pour l'affichage visuel de la progression. */
  readonly sequenceStepStates = computed<{ label: string; state: SequenceStepState }[]>(() => {
    const steps = this.petri.sequenceSteps();
    const cursor = this.petri.sequenceCursor();
    const error = this.petri.sequenceError();

    return steps.map((label, i) => {
      let state: SequenceStepState;
      if (i < cursor) {
        state = 'done';
      } else if (i === cursor) {
        state = error ? 'error' : 'active';
      } else {
        state = 'pending';
      }
      return { label, state };
    });
  });

  /** Valide la saisie et remet le curseur à zéro. */
  validateSequence() {
    this.petri.parseSequence(this.petri.sequenceInput());
  }

  /** Un pas manuel dans la séquence. */
  stepSequence() {
    // Valider si pas encore fait
    if (!this.sequenceParsed()) {
      this.petri.parseSequence(this.petri.sequenceInput());
      if (!this.sequenceParsed()) return;
    }
    this.petri.stepSequence();
  }

  /** Jouer / arrêter la séquence automatique. */
  toggleSequenceRun() {
    if (this.petri.sequenceRunning()) {
      this.petri.stopSequence();
    } else {
      if (!this.sequenceParsed()) {
        this.petri.parseSequence(this.petri.sequenceInput());
        if (!this.sequenceParsed()) return;
      }
      this.petri.runSequence();
    }
  }

  /** Remet la séquence au début (sans effacer la saisie). */
  resetSequence() {
    this.petri.resetSequence();
    this.petri.reset();
  }
}
