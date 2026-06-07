import { Component, inject, computed, effect, input, output } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GraphService } from '../../core/services/graph.service';
import { AlgorithmRunnerService } from '../../core/services/algorithm-runner.service';
import { AlgorithmDef } from '../../core/models/algorithm.models';
import { ConfirmResetDialogComponent } from './confirm-reset-dialog.component';

@Component({
  selector: 'app-algorithm-panel',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './algorithm-panel.component.html',
  styleUrl: './algorithm-panel.component.scss',
})
export class AlgorithmPanelComponent {
  protected graphService = inject(GraphService);
  protected runner = inject(AlgorithmRunnerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  readonly mode = input<'edit' | 'visualise'>('edit');
  readonly modeChange = output<'visualise'>();

  algDropdownOpen = false;
  paramForm = new FormGroup<Record<string, FormControl>>({});

  readonly validationError = computed(() => {
    const alg = this.runner.selectedAlgorithm();
    if (!alg) return null;
    return alg.validate(this.graphService.graph());
  });

  constructor() {
    effect(() => {
      const alg = this.runner.selectedAlgorithm();
      this.rebuildForm(alg);
    });
    effect(() => { void this.graphService.graph(); });
  }

  private rebuildForm(alg: AlgorithmDef | null) {
    const controls: Record<string, FormControl> = {};
    if (alg) {
      for (const inp of alg.inputs) {
        const validators = inp.required ? [Validators.required] : [];
        controls[inp.key] = new FormControl(inp.default ?? null, validators);
      }
    }
    this.paramForm = new FormGroup(controls);
  }

  selectAlgorithm(id: string) {
    this.runner.selectAlgorithm(id);
    this.algDropdownOpen = false;
  }

  setDirected(directed: boolean) {
    this.graphService.setDirected(directed);
  }

  setWeighted(weighted: boolean) {
    this.graphService.setWeighted(weighted);
  }

  runAlgorithm() {
    const alg = this.runner.selectedAlgorithm();
    if (!alg || this.validationError()) return;
    if (this.paramForm.invalid) {
      this.snackBar.open('Veuillez remplir tous les paramètres requis.', 'OK', { duration: 3000 });
      return;
    }
    this.runner.runAlgorithm(this.graphService.graph(), this.paramForm.value);
    this.modeChange.emit('visualise');
  }

  resetGraph() {
    const ref = this.dialog.open(ConfirmResetDialogComponent);
    ref.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.graphService.reset();
        this.runner.reset();
        this.snackBar.open('Graphe réinitialisé.', 'OK', { duration: 2000 });
      }
    });
  }

  getDirectednessLabel(alg: AlgorithmDef): string {
    if (alg.requiresDirected === true) return 'Orienté';
    if (alg.requiresDirected === false) return 'Non orienté';
    return 'Orienté / Non orienté';
  }

  getWeightChipTone(alg: AlgorithmDef): 'amber' | 'neutral' {
    return alg.requiresWeights ? 'amber' : 'neutral';
  }
}
