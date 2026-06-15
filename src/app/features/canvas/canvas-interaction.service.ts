import { Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { GraphService } from '../../core/services/graph.service';
import { CanvasRenderService } from './canvas-render.service';

export interface ContextMenuData {
  type: 'vertex' | 'edge';
  id: string;
  x: number;
  y: number;
}

const DRAG_THRESHOLD = 6; // px before drag or pan activates

@Injectable()
export class CanvasInteractionService {
  readonly selected      = signal<Set<string>>(new Set());
  readonly contextMenu   = signal<ContextMenuData | null>(null);
  readonly renameOverlay = signal<{ id: string; x: number; y: number; label: string } | null>(null);
  readonly weightOverlay = signal<{ edgeId: string; x: number; y: number; value: string } | null>(null);

  // ── Drag / pan state (committed only after DRAG_THRESHOLD) ─────────────────
  private dragging: { id: string; startX: number; startY: number; origX: number; origY: number } | null = null;
  private panning = false;

  // Pending intent recorded at mousedown, committed in mousemove once threshold crossed
  private pendingDragVertex: { id: string; origX: number; origY: number } | null = null;
  private pendingPan = false;

  // Edge drag (Shift + drag vertex → vertex)
  private edgeDragSrc: string | null = null;

  // Shared mousedown origin for threshold calculation
  private mouseDownPos = { x: 0, y: 0 };

  // Tracks whether the pointer moved enough to count as a drag (not a click)
  private movedSignificantly = false;

  // Prevents handleClick from acting after an edge was already handled in mouseup
  private skipNextClick = false;

  constructor(
    private graphService: GraphService,
    private renderService: CanvasRenderService,
    private dialog: MatDialog,
  ) {}

  // ── Mouse down — record intent only, never commit immediately ──────────────
  handleMouseDown(e: MouseEvent, svgEl: SVGSVGElement, mode: string) {
    // if (mode !== 'edit') return;
    
    this.mouseDownPos = { x: e.clientX, y: e.clientY };
    this.movedSignificantly = false;
    this.pendingDragVertex = null;
    this.pendingPan = false;

    // Middle mouse → pan immediately (no click ambiguity)
    if (e.button === 1) { this.panning = true; return; }
    if (e.button !== 0) return;
    
    const { x, y } = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
    const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);
    
    if (hitVertex && mode == 'edit') {
      if (e.shiftKey) {
        // Shift + press on vertex → start edge drag immediately (visual feedback from first pixel)
        this.edgeDragSrc = hitVertex;
        this.renderService.dragLineEnd.set({ x, y });
        return;
      }
      // Record as pending drag; will commit once DRAG_THRESHOLD is crossed in mousemove
      const v = this.graphService.graph().vertices.find(v => v.id === hitVertex)!;
      this.pendingDragVertex = { id: hitVertex, origX: v.x, origY: v.y };
    } else {
      // Empty space: pending pan; will commit once DRAG_THRESHOLD is crossed
      this.pendingPan = true;
    }
  }

  // ── Mouse move — commit to drag/pan only after threshold ───────────────────
  handleMouseMove(e: MouseEvent, svgEl: SVGSVGElement) {
    // Middle-mouse pan (committed immediately)
    if (this.panning && e.buttons & 4) {
      this.renderService.panX.update(p => p + e.movementX);
      this.renderService.panY.update(p => p + e.movementY);
      return;
    }
    const dist = Math.hypot(e.clientX - this.mouseDownPos.x, e.clientY - this.mouseDownPos.y);
    if (dist > DRAG_THRESHOLD) this.movedSignificantly = true;
    
    // Commit pending pan once threshold is crossed
    if (this.pendingPan && dist > DRAG_THRESHOLD) {
      this.panning = true;
      this.pendingPan = false;
      console.log("MOVED", dist)  
    }

    // Commit pending vertex drag once threshold is crossed
    if (this.pendingDragVertex && dist > DRAG_THRESHOLD && !this.dragging) {
      this.dragging = {
        id:     this.pendingDragVertex.id,
        startX: this.mouseDownPos.x,
        startY: this.mouseDownPos.y,
        origX:  this.pendingDragVertex.origX,
        origY:  this.pendingDragVertex.origY,
      };
      this.selected.set(new Set([this.pendingDragVertex.id]));
      this.pendingDragVertex = null;
    }

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
      return;
    }

    // Ghost line for edge drag
    if (this.edgeDragSrc) {
      const wc = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
      this.renderService.dragLineEnd.set(wc);
    }
  }

  // ── Mouse up — finalise edge drag; click event handles everything else ─────
  handleMouseUp(e: MouseEvent, svgEl: SVGSVGElement) {
    this.panning = false;
    this.dragging = null;
    this.pendingDragVertex = null;
    this.pendingPan = false;

    const src = this.edgeDragSrc;
    this.edgeDragSrc = null;
    this.renderService.dragLineEnd.set(null);

    if (src) {
      const wc = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
      const hit = this.renderService.hitTestVertex(this.graphService.graph(), wc.x, wc.y);
      if (hit && hit !== src) this.createEdge(src, hit);
      // Suppress the click that fires right after mouseup so we don't double-act
      this.skipNextClick = true;
    }
  }

  // ── Click — selection, vertex creation, context menu ──────────────────────
  handleClick(e: MouseEvent, svgEl: SVGSVGElement, mode: string) {
    if (mode !== 'edit') return;
    if (this.skipNextClick) { this.skipNextClick = false; return; }
    if (e.shiftKey) return;   // Shift+click is the edge-drag gesture; handled by mouseup

    const { x, y } = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);

    // Ctrl+click → open context menu
    if (e.ctrlKey) {
      const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);
      if (hitVertex) {
        this.contextMenu.set({ type: 'vertex', id: hitVertex, x: e.clientX, y: e.clientY });
        return;
      }
      const hitEdge = this.renderService.hitTestEdge(this.graphService.graph(), x, y);
      if (hitEdge) this.contextMenu.set({ type: 'edge', id: hitEdge, x: e.clientX, y: e.clientY });
      return;
    }

    // Regular click on vertex → select
    const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);
    if (hitVertex) { this.selected.set(new Set([hitVertex])); return; }

    // Regular click on edge → select
    const hitEdge = this.renderService.hitTestEdge(this.graphService.graph(), x, y);
    if (hitEdge) { this.selected.set(new Set([hitEdge])); return; }

    // Click on empty space → add vertex (only when the pointer didn't pan)
    if (!this.movedSignificantly) {
      const v = this.graphService.addVertex({ x, y });
      this.renameOverlay.set({ id: v.id, x: e.clientX, y: e.clientY, label: v.label });
    }
    this.selected.set(new Set());
  }

  // ── Double-click ───────────────────────────────────────────────────────────
  handleDblClick(e: MouseEvent, svgEl: SVGSVGElement, mode: string) {
    if (mode !== 'edit') return;
    const { x, y } = this.renderService.screenToWorld(svgEl, e.clientX, e.clientY);
    const hitVertex = this.renderService.hitTestVertex(this.graphService.graph(), x, y);
    if (hitVertex) {
      const v = this.graphService.graph().vertices.find(v => v.id === hitVertex)!;
      this.renameOverlay.set({ id: hitVertex, x: e.clientX, y: e.clientY, label: v.label });
      return;
    }
    const hitEdge = this.renderService.hitTestEdge(this.graphService.graph(), x, y);
    if (hitEdge) {
      const edge = this.graphService.graph().edges.find(e => e.id === hitEdge)!;
      this.weightOverlay.set({ edgeId: hitEdge, x: e.clientX, y: e.clientY, value: String(edge.weight ?? '') });
    }
  }

  // ── Context menu (right-click) — suppressed; user uses Ctrl+click ──────────
  handleContextMenu(e: MouseEvent) { e.preventDefault(); }

  // ── Scroll wheel ───────────────────────────────────────────────────────────
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

  // ── Keyboard ───────────────────────────────────────────────────────────────
  handleKeyDown(e: KeyboardEvent, mode: string) {
    if (mode !== 'edit') return; 
    // Removed the backspace key, only keep the Delete key
    if (e.key === 'Delete') {
      for (const id of this.selected()) {
        if (this.graphService.graph().vertices.some(v => v.id === id))
          this.graphService.removeVertex(id);
        else if (this.graphService.graph().edges.some(ed => ed.id === id))
          this.graphService.removeEdge(id);
      }
      this.selected.set(new Set());
    }
  }

  // ── Overlay actions ────────────────────────────────────────────────────────
  confirmRename(id: string, newLabel: string) {
    this.graphService.updateVertex(id, { label: newLabel });
    this.renameOverlay.set(null);
  }

  cancelRename(id: string) {
    const g = this.graphService.graph();
    if (!g.edges.some(e => e.source === id || e.target === id))
      this.graphService.removeVertex(id);
    this.renameOverlay.set(null);
  }

  confirmWeight(edgeId: string, value: string) {
    const w = parseFloat(value);
    if (!isNaN(w)) this.graphService.updateEdge(edgeId, { weight: w });
    this.weightOverlay.set(null);
  }

  contextMenuAction(action: string, id: string, type: 'vertex' | 'edge') {
    this.contextMenu.set(null);
    if (action === 'rename' && type === 'vertex') {
      const v = this.graphService.graph().vertices.find(v => v.id === id);
      if (v) this.renameOverlay.set({ id, x: 400, y: 300, label: v.label });
    } else if (action === 'delete') {
      if (type === 'vertex') this.graphService.removeVertex(id);
      else this.graphService.removeEdge(id);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────
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
