import { Component, inject, computed, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { AlgorithmRunnerService } from '../../core/services/algorithm-runner.service';
import { GraphService } from '../../core/services/graph.service';

@Component({
  selector: 'app-output-panel',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatChipsModule, MatListModule,
    MatExpansionModule, MatIconModule, MatDividerModule,
  ],
  templateUrl: './output-panel.component.html',
  styleUrl: './output-panel.component.scss',
})
export class OutputPanelComponent {
  @ViewChild('stepList') stepListEl!: ElementRef<HTMLElement>;

  protected runner = inject(AlgorithmRunnerService);
  protected graphService = inject(GraphService);

  readonly algId = computed(() => this.runner.selectedAlgorithm()?.id ?? null);
  readonly step = computed(() => this.runner.currentStep());
  readonly steps = computed(() => this.runner.steps());
  readonly stepIndex = computed(() => this.runner.currentStepIndex());
  readonly isLast = computed(() => this.runner.currentStepIndex() >= this.runner.steps().length - 1);

  // Dijkstra table rows
  readonly dijkstraRows = computed(() => {
    const s = this.step();
    if (!s) return [];
    const dist = s.metadata['distances'] as Record<string, number>;
    const prev = s.metadata['previous'] as Record<string, string | null>;
    const visited = s.metadata['visited'] as string[];
    return this.graphService.graph().vertices.map(v => ({
      id: v.id,
      label: v.label,
      distance: dist?.[v.id] === Infinity ? '∞' : String(dist?.[v.id] ?? '?'),
      previous: prev?.[v.id] ? this.graphService.graph().vertices.find(x => x.id === prev[v.id])?.label ?? prev[v.id] : '—',
      status: visited?.includes(v.id) ? 'visited' : (dist?.[v.id] < Infinity ? 'frontier' : 'unvisited'),
      active: s.vertexStates[v.id] === 'active',
    }));
  });

  // Bellman-Ford rows
  readonly bfRows = computed(() => {
    const s = this.step();
    if (!s) return [];
    const dist = s.metadata['distances'] as Record<string, number>;
    const prev = s.metadata['previous'] as Record<string, string | null>;
    return this.graphService.graph().vertices.map(v => ({
      id: v.id,
      label: v.label,
      distance: dist?.[v.id] === Infinity ? '∞' : String(dist?.[v.id] ?? '?'),
      previous: prev?.[v.id] ? this.graphService.graph().vertices.find(x => x.id === prev[v.id])?.label ?? prev[v.id] : '—',
    }));
  });

  readonly bfPass = computed(() => (this.step()?.metadata?.['pass'] as number) ?? 0);
  readonly bfNegCycle = computed(() => !!(this.step()?.metadata?.['negCycleDetected']));

  // A* data
  readonly astarOpenSet = computed(() => (this.step()?.metadata?.['openSet'] as any[]) ?? []);
  readonly astarClosedSet = computed(() => (this.step()?.metadata?.['closedSet'] as any[]) ?? []);
  readonly astarCurrentNode = computed(() => {
    const s = this.step();
    if (!s) return null;
    const cur = s.metadata['current'] as string | undefined;
    if (!cur) return null;
    const v = this.graphService.graph().vertices.find(x => x.id === cur);
    const openSet = s.metadata['openSet'] as any[];
    const entry = openSet?.find((o: any) => o.id === cur);
    return entry ? { label: v?.label ?? cur, f: entry.f, g: entry.g, h: entry.h } : null;
  });

  // Demoucron
  readonly demPath = computed(() => {
    const ids = (this.step()?.metadata?.['currentPath'] as string[]) ?? [];
    return ids.map(id => this.graphService.graph().vertices.find(v => v.id === id)?.label ?? id);
  });
  readonly demBacktracks = computed(() => (this.step()?.metadata?.['backtracks'] as number) ?? 0);
  readonly demStatus = computed(() => (this.step()?.metadata?.['status'] as string) ?? 'searching');

  // Final result
  readonly finalPath = computed(() => {
    const s = this.steps();
    if (!s.length) return [];
    const last = s[s.length - 1];
    const path = (last.metadata['currentPath'] as string[]) ?? [];
    return path.map(id => this.graphService.graph().vertices.find(v => v.id === id)?.label ?? id);
  });

  readonly finalDistance = computed(() => {
    const s = this.steps();
    if (!s.length) return null;
    const last = s[s.length - 1];
    const dist = last.metadata['distances'] as Record<string, number> | undefined;
    const path = (last.metadata['currentPath'] as string[]) ?? [];
    if (!dist || !path.length) return null;
    const target = path[path.length - 1];
    const targetId = this.graphService.graph().vertices.find(v => v.label === target)?.id;
    return targetId && dist[targetId] !== Infinity ? dist[targetId] : null;
  });

  readonly exploredCount = computed(() => {
    const s = this.steps();
    if (!s.length) return 0;
    const last = s[s.length - 1];
    return ((last.metadata['closedSet'] as string[]) ?? []).length;
  });

  constructor() {
    effect(() => {
      void this.runner.currentStepIndex();
      setTimeout(() => this.scrollStepIntoView(), 50);
    });
  }

  private scrollStepIntoView() {
    const el = this.stepListEl?.nativeElement;
    if (!el) return;
    const active = el.querySelector('.step-active') as HTMLElement;
    active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  vertexLabel(id: string) {
    return this.graphService.graph().vertices.find(v => v.id === id)?.label ?? id;
  }
}
