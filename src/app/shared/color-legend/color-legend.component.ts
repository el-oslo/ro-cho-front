import { Component } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { STATE_COLORS } from '../../features/canvas/canvas-render.service';

@Component({
  selector: 'app-color-legend',
  standalone: true,
  imports: [MatChipsModule],
  template: `
    <mat-chip-set class="legend">
      @for (entry of entries; track entry.label) {
        <mat-chip class="legend-chip" [style.background]="entry.color">
          {{ entry.label }}
        </mat-chip>
      }
    </mat-chip-set>
  `,
  styles: [`
    .legend { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
    .legend-chip { font-size: 0.75rem; height: 26px; color: #fff; }
  `],
})
export class ColorLegendComponent {
  readonly entries = Object.entries(STATE_COLORS).map(([state, color]) => ({
    label: state.charAt(0).toUpperCase() + state.slice(1),
    color,
  }));
}
