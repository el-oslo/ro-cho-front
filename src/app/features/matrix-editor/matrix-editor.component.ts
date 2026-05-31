import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GraphService } from '../../core/services/graph.service';

@Component({
  selector: 'app-matrix-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCheckboxModule, MatIconModule, MatButtonModule, MatInputModule, MatTooltipModule],
  templateUrl: './matrix-editor.component.html',
  styleUrl: './matrix-editor.component.scss',
})
export class MatrixEditorComponent {
  protected graphService = inject(GraphService);

  readonly vertices = computed(() => this.graphService.graph().vertices);
  readonly edges = computed(() => this.graphService.graph().edges);
  readonly weighted = computed(() => this.graphService.graph().weighted);
  readonly directed = computed(() => this.graphService.graph().directed);

  getEdge(srcId: string, tgtId: string) {
    const g = this.graphService.graph();
    return g.edges.find(e =>
      (e.source === srcId && e.target === tgtId) ||
      (!g.directed && e.source === tgtId && e.target === srcId)
    ) ?? null;
  }

  getCellWeight(srcId: string, tgtId: string): number | null {
    return this.getEdge(srcId, tgtId)?.weight ?? null;
  }

  isCellChecked(srcId: string, tgtId: string): boolean {
    return !!this.getEdge(srcId, tgtId);
  }

  onWeightChange(srcId: string, tgtId: string, value: string) {
    const w = parseFloat(value);
    const existing = this.getEdge(srcId, tgtId);
    if (isNaN(w) || value === '') {
      if (existing) this.graphService.removeEdge(existing.id);
      return;
    }
    if (existing) {
      this.graphService.updateEdge(existing.id, { weight: w });
      if (!this.directed()) {
        const rev = this.getEdge(tgtId, srcId);
        if (rev && rev.id !== existing.id) this.graphService.updateEdge(rev.id, { weight: w });
      }
    } else {
      this.graphService.addEdge(srcId, tgtId, w);
    }
  }

  onCheckChange(srcId: string, tgtId: string, checked: boolean) {
    const existing = this.getEdge(srcId, tgtId);
    if (checked && !existing) {
      this.graphService.addEdge(srcId, tgtId);
      if (!this.directed()) this.graphService.addEdge(tgtId, srcId);
    } else if (!checked && existing) {
      this.graphService.removeEdge(existing.id);
      if (!this.directed()) {
        const rev = this.getEdge(tgtId, srcId);
        if (rev) this.graphService.removeEdge(rev.id);
      }
    }
  }

  renameVertex(id: string, label: string) {
    this.graphService.updateVertex(id, { label });
  }

  removeVertex(id: string) {
    this.graphService.removeVertex(id);
  }

  addVertex() {
    const n = this.vertices().length;
    const angle = (2 * Math.PI * n) / (n + 1);
    const r = 80 + n * 15;
    this.graphService.addVertex({ x: 300 + r * Math.cos(angle), y: 240 + r * Math.sin(angle) });
  }
}
