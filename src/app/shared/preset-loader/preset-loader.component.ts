import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { GraphPreset, AlgorithmDef } from '../../core/models/algorithm.models';

export interface PresetLoaderData {
  algorithms: AlgorithmDef[];
  selectedAlgId: string | null;
}

export interface PresetLoaderResult {
  preset: GraphPreset;
  defaultParams: Record<string, unknown>;
}

@Component({
  selector: 'app-preset-loader',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatListModule, MatIconModule],
  templateUrl: './preset-loader.component.html',
  styleUrl: './preset-loader.component.scss',
})
export class PresetLoaderComponent {
  protected data = inject<PresetLoaderData>(MAT_DIALOG_DATA);
  protected dialogRef = inject(MatDialogRef<PresetLoaderComponent>);

  selectedAlg: AlgorithmDef | null =
    this.data.algorithms.find(a => a.id === this.data.selectedAlgId) ?? this.data.algorithms[0] ?? null;
  selectedPreset: GraphPreset | null = null;

  selectAlg(alg: AlgorithmDef) {
    this.selectedAlg = alg;
    this.selectedPreset = null;
  }

  selectPreset(preset: GraphPreset) {
    this.selectedPreset = preset;
  }

  confirm() {
    if (this.selectedPreset) {
      this.dialogRef.close({
        preset: this.selectedPreset,
        defaultParams: this.selectedPreset.defaultParams ?? {},
      } as PresetLoaderResult);
    }
  }
}
