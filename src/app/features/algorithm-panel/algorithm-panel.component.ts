import { Component, inject, computed, effect, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { GraphService } from '../../core/services/graph.service';
import { AlgorithmRunnerService } from '../../core/services/algorithm-runner.service';
import { AlgorithmDef } from '../../core/models/algorithm.models';
import { ConfirmResetDialogComponent } from './confirm-reset-dialog.component';

@Component({
  selector: 'app-algorithm-panel',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatListModule, MatCardModule, MatChipsModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatCheckboxModule, MatButtonModule, MatIconModule, MatDividerModule,
  ],
  templateUrl: './algorithm-panel.component.html',
  styleUrl: './algorithm-panel.component.scss',
})
export class AlgorithmPanelComponent {
  protected graphService = inject(GraphService);
  protected runner = inject(AlgorithmRunnerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  readonly modeChange = output<'visualise'>();

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
    effect(() => {
      // Revalidate when graph changes
      void this.graphService.graph();
    });
  }

  private rebuildForm(alg: AlgorithmDef | null) {
    const controls: Record<string, FormControl> = {};
    if (alg) {
      for (const input of alg.inputs) {
        const validators = input.required ? [Validators.required] : [];
        controls[input.key] = new FormControl(input.default ?? null, validators);
      }
    }
    this.paramForm = new FormGroup(controls);
  }

  runAlgorithm() {
    const alg = this.runner.selectedAlgorithm();
    if (!alg || this.validationError()) return;
    if (this.paramForm.invalid) {
      this.snackBar.open('Please fill in all required parameters.', 'OK', { duration: 3000 });
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
        this.snackBar.open('Graph reset.', 'OK', { duration: 2000 });
      }
    });
  }

  loadPresetParams(params: Record<string, unknown>) {
    for (const [key, val] of Object.entries(params)) {
      this.paramForm.get(key)?.setValue(val);
    }
  }

  getDirectednessLabel(alg: AlgorithmDef): string {
    if (alg.requiresDirected === true) return 'Directed';
    if (alg.requiresDirected === false) return 'Undirected';
    return 'Both';
  }
}
