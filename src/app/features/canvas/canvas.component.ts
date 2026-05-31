import {
  Component, ElementRef, ViewChild, inject, effect, input, OnDestroy, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
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
    MatMenuModule, MatFormFieldModule, MatInputModule, FormsModule,
    ColorLegendComponent,
  ],
  providers: [CanvasRenderService, CanvasInteractionService],
  templateUrl: './canvas.component.html',
  styleUrl: './canvas.component.scss',
})
export class CanvasComponent implements OnDestroy {
  @ViewChild('svgEl') svgEl!: ElementRef<SVGSVGElement>;

  readonly mode = input<'edit' | 'visualise'>('edit');
  readonly darkMode = input<boolean>(true);

  protected graphService = inject(GraphService);
  protected runner = inject(AlgorithmRunnerService);
  protected renderService = inject(CanvasRenderService);
  protected interaction = inject(CanvasInteractionService);

  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private dirty = true;

  renameValue = '';
  weightValue = '';

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
      void this.interaction.pendingEdgeSource();
      void this.renderService.zoom();
      void this.renderService.panX();
      void this.renderService.panY();
      void this.renderService.showGrid();
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
      this.interaction.pendingEdgeSource(),
    );
  }

  // SVG event handlers
  onMouseDown(e: MouseEvent) {
    this.interaction.handleMouseDown(e, this.svgEl.nativeElement, this.mode());
  }
  onMouseMove(e: MouseEvent) {
    this.interaction.handleMouseMove(e, this.svgEl.nativeElement);
  }
  onMouseUp(e: MouseEvent) {
    this.interaction.handleMouseUp(e);
  }
  onClick(e: MouseEvent) {
    this.interaction.handleClick(e, this.svgEl.nativeElement, this.mode());
  }
  onDblClick(e: MouseEvent) {
    const overlay = this.interaction.renameOverlay();
    if (overlay) return;
    this.interaction.handleDblClick(e, this.svgEl.nativeElement, this.mode());
    const r = this.interaction.renameOverlay();
    if (r) this.renameValue = r.label;
    const w = this.interaction.weightOverlay();
    if (w) this.weightValue = w.value;
  }
  onContextMenu(e: MouseEvent) {
    this.interaction.handleContextMenu(e, this.svgEl.nativeElement, this.mode());
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
}
