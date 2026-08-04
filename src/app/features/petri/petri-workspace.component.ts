import { Component, inject, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PetriService } from '../../core/services/petri.service';
import { PetriCanvasComponent } from './petri-canvas.component';
import { PetriMatrixComponent } from './petri-matrix.component';
import { PetriControlsComponent } from './petri-controls.component';

/** Orchestrateur de la vue « Réseaux de Petri » : rail de contrôle à gauche,
 *  scène (canevas / matrices) au centre, journal de franchissement à droite. */
@Component({
  selector: 'app-petri-workspace',
  standalone: true,
  imports: [CommonModule, PetriCanvasComponent, PetriMatrixComponent, PetriControlsComponent],
  templateUrl: './petri-workspace.component.html',
  styleUrl: './petri-workspace.component.scss',
})
export class PetriWorkspaceComponent {
  readonly darkMode = input<boolean>(false);

  protected petri = inject(PetriService);

  readonly activeTab = signal<'canvas' | 'matrix'>('canvas');
  readonly controlsCollapsed = signal(false);
  readonly logCollapsed = signal(false);

  private labelOf(id: string): string {
    return this.petri.places().find(p => p.id === id)?.label
        ?? this.petri.transitions().find(t => t.id === id)?.label
        ?? id;
  }

  /** Journal fusionné (franchissements + injections), le plus récent en tête. */
  readonly log = computed(() => {
    const fires = this.petri.firingLog().map(e => ({
      kind: 'fire' as const, label: this.labelOf(e.transitionId), ts: e.timestamp,
    }));
    const injects = this.petri.injectionLog().map(e => ({
      kind: 'inject' as const, label: this.labelOf(e.placeId), amount: e.amount, ts: e.timestamp,
    }));
    return [...fires, ...injects].sort((a, b) => b.ts - a.ts).slice(0, 60);
  });

  readonly fireCount = computed(() => this.petri.firingLog().length);
  readonly injectCount = computed(() => this.petri.injectionLog().length);

  time(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('fr-FR', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
}
