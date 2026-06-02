import {
  Component, ElementRef, ViewChild, inject, effect, input, output, OnDestroy, HostListener, computed
} from '@angular/core';
import { MatMenuTrigger } from '@angular/material/menu';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { GraphService } from '../../core/services/graph.service';
import { AlgorithmRunnerService } from '../../core/services/algorithm-runner.service';
import { CanvasRenderService } from './canvas-render.service';
import { CanvasInteractionService } from './canvas-interaction.service';
import { ColorLegendComponent } from '../../shared/color-legend/color-legend.component';

@Component({
  selector: 'app-canvas',
  standalone: true,
  imports: [
    CommonModule, MatButtonModule, MatIconModule, MatTooltipModule,
    MatMenuModule, MatFormFieldModule, MatInputModule,
    MatButtonToggleModule, MatSlideToggleModule, FormsModule,
    ColorLegendComponent,
  ],
  providers: [CanvasRenderService, CanvasInteractionService],
  templateUrl: './canvas.component.html',
  styleUrl: './canvas.component.scss',
})
export class CanvasComponent implements OnDestroy {
  @ViewChild('svgEl') svgEl!: ElementRef<SVGSVGElement>;
  @ViewChild('ctxMenuTrigger') ctxMenuTrigger!: MatMenuTrigger;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  readonly mode = input<'edit' | 'visualise'>('edit');
  readonly darkMode = input<boolean>(true);
  readonly outputPanelOpen = input<boolean>(false);

  readonly modeChange = output<'edit' | 'visualise'>();
  readonly toggleOutputPanel = output<void>();
  readonly loadPreset = output<void>();

  protected graphService = inject(GraphService);
  protected runner = inject(AlgorithmRunnerService);
  protected renderService = inject(CanvasRenderService);
  protected interaction = inject(CanvasInteractionService);

  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private dirty = true;

  renameValue = '';
  weightValue = '';

  readonly hasSelection = computed(() => this.interaction.selected().size > 0);

  constructor() {
    const loop = () => {
      if (this.dirty && this.svgEl?.nativeElement) {
        this.drawFrame();
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);

    effect(() => {
      void this.graphService.graph();
      void this.runner.currentStep();
      void this.interaction.selected();
      void this.renderService.zoom();
      void this.renderService.panX();
      void this.renderService.panY();
      void this.renderService.showGrid();
      void this.renderService.dragLineEnd();
      void this.darkMode();
      this.dirty = true;
    });

    this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
  }

  ngAfterViewInit() {
    this.resizeObserver.observe(this.svgEl.nativeElement.parentElement!);
    this.renderService.darkMode.set(this.darkMode());
  }

  ngOnChanges() {
    this.renderService.darkMode.set(this.darkMode());
    this.dirty = true;
  }

  ngOnDestroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
  }

  private drawFrame() {
    const svg = this.svgEl?.nativeElement;
    if (!svg) return;
    this.renderService.render(
      svg,
      this.graphService.graph(),
      this.runner.currentStep(),
      this.interaction.selected(),
      null,
    );
  }

  onMouseDown(e: MouseEvent) {
    this.interaction.handleMouseDown(e, this.svgEl.nativeElement, this.mode());
  }
  onMouseMove(e: MouseEvent) {
    this.interaction.handleMouseMove(e, this.svgEl.nativeElement);
  }
  onMouseUp(e: MouseEvent) {
    this.interaction.handleMouseUp(e, this.svgEl.nativeElement);
  }
  onClick(e: MouseEvent) {
    this.interaction.handleClick(e, this.svgEl.nativeElement, this.mode());
    if (this.interaction.contextMenu()) {
      setTimeout(() => this.ctxMenuTrigger?.openMenu(), 0);
    }
  }
  onDblClick(e: MouseEvent) {
    if (this.interaction.renameOverlay()) return;
    this.interaction.handleDblClick(e, this.svgEl.nativeElement, this.mode());
    const r = this.interaction.renameOverlay();
    if (r) this.renameValue = r.label;
    const w = this.interaction.weightOverlay();
    if (w) this.weightValue = w.value;
  }
  onContextMenu(e: MouseEvent) {
    this.interaction.handleContextMenu(e);
  }
  onWheel(e: WheelEvent) {
    this.interaction.handleWheel(e, this.svgEl.nativeElement);
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    this.interaction.handleKeyDown(e, this.mode());
  }

  confirmRename() {
    const o = this.interaction.renameOverlay();
    if (o) this.interaction.confirmRename(o.id, this.renameValue);
  }
  cancelRename() {
    const o = this.interaction.renameOverlay();
    if (o) this.interaction.cancelRename(o.id);
  }
  confirmWeight() {
    const o = this.interaction.weightOverlay();
    if (o) { this.interaction.confirmWeight(o.edgeId, this.weightValue); }
  }
  cancelWeight() {
    this.interaction.weightOverlay.set(null);
  }

  zoomIn() { this.renderService.zoomIn(this.svgEl.nativeElement); }
  zoomOut() { this.renderService.zoomOut(this.svgEl.nativeElement); }
  fitToScreen() { this.renderService.fitToScreen(this.svgEl.nativeElement, this.graphService.graph()); }
  toggleGrid() { this.renderService.showGrid.update(v => !v); }

  addVertexAtCenter() {
    if (this.mode() !== 'edit') return;
    const svg = this.svgEl.nativeElement;
    const rect = svg.getBoundingClientRect();
    const center = this.renderService.screenToWorld(svg, rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.graphService.addVertex(center);
  }

  deleteSelected() {
    if (this.mode() !== 'edit') return;
    for (const id of this.interaction.selected()) {
      if (this.graphService.graph().vertices.some(v => v.id === id)) {
        this.graphService.removeVertex(id);
      } else if (this.graphService.graph().edges.some(e => e.id === id)) {
        this.graphService.removeEdge(id);
      }
    }
    this.interaction.selected.set(new Set());
  }

  circularLayout() {
    const verts = this.graphService.graph().vertices;
    const n = verts.length;
    if (!n) return;
    const svg = this.svgEl.nativeElement;
    const rect = svg.getBoundingClientRect();
    const cx = this.renderService.screenToWorld(svg, rect.left + rect.width / 2, rect.top + rect.height / 2).x;
    const cy = this.renderService.screenToWorld(svg, rect.left + rect.width / 2, rect.top + rect.height / 2).y;
    const r = 80 + n * 18;
    verts.forEach((v, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      this.graphService.updateVertex(v.id, {
        x: Math.round(cx + r * Math.cos(angle)),
        y: Math.round(cy + r * Math.sin(angle)),
      });
    });
  }

  onDirectedChange(value: string) {
    this.graphService.setDirected(value === 'directed');
  }

  onWeightedChange(checked: boolean) {
    this.graphService.setWeighted(checked);
  }

  triggerImport() {
    this.fileInput.nativeElement.value = '';
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await this.graphService.importJSON(file);
  }
}