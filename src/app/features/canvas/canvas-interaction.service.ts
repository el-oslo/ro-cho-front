import { Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuTrigger } from '@angular/material/menu';
import { GraphService } from '../../core/services/graph.service';
import { CanvasRenderService } from './canvas-render.service';
import { Graph } from '../../core/models/graph.models';

export interface ContextMenuData {
  type: 'vertex' | 'edge';
  id: string;
  x: number;
  y: number;
}

export interface WeightDialogResult {
  weight: number;
}

@Injectable()
export class CanvasInteractionService {
  readonly selected = signal<Set<string>>(new Set());
  readonly pendingEdgeSource = signal<string | null>(null);
  readonly contextMenu = signal<ContextMenuData | null>(null);
  readonly renameOverlay = signal<{ id: string; x: number; y: number; label: string } | null>(null);
  readonly weightOverlay = signal<{ edgeId: string; x: number; y: number; value: string } | null>(null);

  private dragging: { id: string; startX: number; startY: number; origX: number; origY: number } | null = null;
  private panning = false;
  private panStartX = 0;
  private panStartY = 0;

  constructor(
    private graphService: GraphService,
    private renderService: CanvasRenderService,
    private dialog: MatDialog,
  ) {}

  handleMouseDown(e: MouseEvent, svgEl: SVGSVGElement, mode: string) {
    if (mode !== 'edit') return;

    // Middle-mouse or Space+drag pan
    if (e.button === 1 || (e.button === 0 && e.getModifierState?.('Space'))) {
      this.panning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      return;
    }

    if (e.button !== 0) return;

    const { x, y } = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
    const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);

    if (hitVertex) {
      const v = this.graphService.graph().vertices.find(v => v.id === hitVertex)!;
      if (e.shiftKey) {
        this.selected.update(s => {
          const ns = new Set(s);
          ns.has(hitVertex) ? ns.delete(hitVertex) : ns.add(hitVertex);
          return ns;
        });
        return;
      }
      // Start drag or edge connection
      const src = this.pendingEdgeSource();
      if (src && src !== hitVertex) {
        this.createEdge(src, hitVertex);
        this.pendingEdgeSource.set(null);
        return;
      }
      this.dragging = { id: hitVertex, startX: e.clientX, startY: e.clientY, origX: v.x, origY: v.y };
      this.selected.set(new Set([hitVertex]));
    } else {
      this.selected.set(new Set());
      this.pendingEdgeSource.set(null);
    }
  }

  handleMouseMove(e: MouseEvent, svgEl: SVGSVGElement) {
    if (this.panning) {
      this.renderService.panX.update(p => p + e.movementX);
      this.renderService.panY.update(p => p + e.movementY);
      return;
    }
    if (this.dragging) {
      const dx = (e.clientX - this.dragging.startX) / this.renderService.zoom();
      const dy = (e.clientY - this.dragging.startY) / this.renderService.zoom();
      this.graphService.updateVertex(this.dragging.id, {
        x: this.dragging.origX + dx,
        y: this.dragging.origY + dy,
      });
    }
  }

  handleMouseUp(e: MouseEvent) {
    this.panning = false;
    this.dragging = null;
  }

  handleClick(e: MouseEvent, svgEl: SVGSVGElement, mode: string) {
    if (mode !== 'edit') return;
    const { x, y } = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
    const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);

    if (hitVertex) {
      const src = this.pendingEdgeSource();
      if (src === null) {
        // First click: set as edge source
        this.pendingEdgeSource.set(hitVertex);
      }
      return;
    }

    const hitEdge = this.renderService.hitTestEdge(this.graphService.graph(), x, y);
    if (hitEdge) { this.selected.set(new Set([hitEdge])); return; }

    // Click empty space: create vertex
    if (!this.pendingEdgeSource()) {
      const v = this.graphService.addVertex({ x, y });
      this.renameOverlay.set({
        id: v.id,
        x: e.clientX,
        y: e.clientY,
        label: v.label,
      });
    }
    this.pendingEdgeSource.set(null);
    this.selected.set(new Set());
  }

  handleDblClick(e: MouseEvent, svgEl: SVGSVGElement, mode: string) {
    if (mode !== 'edit') return;
    const { x, y } = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
    const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);
    if (hitVertex) {
      const v = this.graphService.graph().vertices.find(v => v.id === hitVertex)!;
      this.renameOverlay.set({ id: hitVertex, x: e.clientX, y: e.clientY, label: v.label });
    } else {
      const hitEdge = this.renderService.hitTestEdge(this.graphService.graph(), x, y);
      if (hitEdge) {
        const edge = this.graphService.graph().edges.find(e => e.id === hitEdge)!;
        this.weightOverlay.set({ edgeId: hitEdge, x: e.clientX, y: e.clientY, value: String(edge.weight ?? '') });
      }
    }
  }

  handleContextMenu(e: MouseEvent, svgEl: SVGSVGElement, mode: string) {
    if (mode !== 'edit') return;
    e.preventDefault();
    const { x, y } = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
    const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);
    if (hitVertex) {
      this.contextMenu.set({ type: 'vertex', id: hitVertex, x: e.clientX, y: e.clientY });
      return;
    }
    const hitEdge = this.renderService.hitTestEdge(this.graphService.graph(), x, y);
    if (hitEdge) {
      this.contextMenu.set({ type: 'edge', id: hitEdge, x: e.clientX, y: e.clientY });
    }
  }

  handleWheel(e: WheelEvent, svgEl: SVGSVGElement) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.3, Math.min(3, this.renderService.zoom() * delta));
    const rect = svgEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const ratio = newZoom / this.renderService.zoom();
    this.renderService.panX.update(px => cx - (cx - px) * ratio);
    this.renderService.panY.update(py => cy - (cy - py) * ratio);
    this.renderService.zoom.set(newZoom);
  }

  handleKeyDown(e: KeyboardEvent, mode: string) {
    if (mode !== 'edit') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      for (const id of this.selected()) {
        if (this.graphService.graph().vertices.some(v => v.id === id)) {
          this.graphService.removeVertex(id);
        } else if (this.graphService.graph().edges.some(ed => ed.id === id)) {
          this.graphService.removeEdge(id);
        }
      }
      this.selected.set(new Set());
    }
  }

  confirmRename(id: string, newLabel: string) {
    this.graphService.updateVertex(id, { label: newLabel });
    this.renameOverlay.set(null);
  }

  cancelRename(id: string) {
    // If vertex has no edges and user cancelled immediately after creation, remove it
    const g = this.graphService.graph();
    const hasEdges = g.edges.some(e => e.source === id || e.target === id);
    if (!hasEdges) this.graphService.removeVertex(id);
    this.renameOverlay.set(null);
  }

  confirmWeight(edgeId: string, value: string) {
    const w = parseFloat(value);
    if (!isNaN(w)) this.graphService.updateEdge(edgeId, { weight: w });
    this.weightOverlay.set(null);
  }

  contextMenuAction(action: string, id: string, type: 'vertex' | 'edge') {
    this.contextMenu.set(null);
    if (type === 'vertex') {
      if (action === 'delete') this.graphService.removeVertex(id);
    } else {
      if (action === 'delete') this.graphService.removeEdge(id);
    }
  }

  private async createEdge(srcId: string, tgtId: string) {
    const graph = this.graphService.graph();
    if (graph.weighted) {
      const weight = await this.promptWeight();
      if (weight !== null) this.graphService.addEdge(srcId, tgtId, weight);
    } else {
      this.graphService.addEdge(srcId, tgtId);
    }
  }

  private promptWeight(): Promise<number | null> {
    return new Promise(resolve => {
      import('./weight-dialog.component').then(m => {
        const ref = this.dialog.open(m.WeightDialogComponent);
        ref.afterClosed().subscribe((val: number | undefined) => {
          resolve(val !== undefined && val !== null ? val : null);
        });
      });
    });
  }
}
