import {
  Component, ElementRef, ViewChild, inject, effect, input, signal, computed,
  OnDestroy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PetriService } from '../../core/services/petri.service';
import { Arc, Place, Point, TextNote, Transition } from '../../core/models/petri.models';
import { PetriLegendComponent } from './petri-legend.component';

type Tool = 'select' | 'place' | 'transition' | 'arc' | 'inject' | 'text';

const PLACE_R = 24;
const TRANS_W = 16;
const TRANS_H = 46;
const DRAG_THRESHOLD = 6;
const FLASH_MS = 450;
const ARC_HIT = 8;       // tolérance (unités monde) pour cliquer une ligne d'arc
const HANDLE_R = 6;      // rayon des poignées de point d'angle

@Component({
  selector: 'app-petri-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule, PetriLegendComponent],
  templateUrl: './petri-canvas.component.html',
  styleUrl: './petri-canvas.component.scss',
})
export class PetriCanvasComponent implements OnDestroy {
  @ViewChild('svgEl') svgEl!: ElementRef<SVGSVGElement>;

  readonly darkMode = input<boolean>(false);

  protected petri = inject(PetriService);

  // ── Outil courant (palette) ─────────────────────────────────────────────────
  readonly tool = signal<Tool>('select');
  readonly selected = signal<string | null>(null);

  // ── Vue (pan / zoom) ─────────────────────────────────────────────────────────
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly showGrid = signal(true);

  // ── Overlays d'édition (inputs positionnés au-dessus du SVG) ─────────────────
  readonly markingOverlay = signal<{ id: string; x: number; y: number; value: string } | null>(null);
  readonly weightOverlay = signal<{ id: string; x: number; y: number; value: string } | null>(null);
  readonly noteOverlay = signal<{ id: string; x: number; y: number; value: string; isNew: boolean } | null>(null);

  // Ghost line pendant la création d'un arc
  private arcSource: string | null = null;
  private ghostEnd = signal<{ x: number; y: number } | null>(null);

  // Drag de nœud / note
  private pendingDrag: { id: string; origX: number; origY: number } | null = null;
  private dragging: { id: string; startX: number; startY: number; origX: number; origY: number } | null = null;
  // Drag d'un point d'angle d'arc
  private pendingHandle: { arcId: string; index: number } | null = null;
  private draggingHandle: { arcId: string; index: number } | null = null;
  // Saisie d'un arc sur sa ligne (pour créer un point d'angle en glissant)
  private pendingArcGrab: { arcId: string; segIndex: number; point: Point } | null = null;

  private pendingPan = false;
  private panning = false;
  private mouseDown = { x: 0, y: 0 };
  private moved = false;

  private rafId: number | null = null;
  private dirty = true;
  private resizeObserver: ResizeObserver;

  // Bornes (monde) des notes texte, calculées au rendu, pour le hit-testing.
  private noteBounds = new Map<string, { x: number; y: number; w: number; h: number }>();

  readonly toolHint = computed(() => {
    switch (this.tool()) {
      case 'place': return 'Cliquez pour ajouter une place';
      case 'transition': return 'Cliquez pour ajouter une transition';
      case 'arc': return 'Cliquez une place puis une transition (ou l’inverse) pour relier';
      case 'inject': return 'Cliquez une place pour injecter un jeton (+1)';
      case 'text': return 'Cliquez pour ajouter une annotation texte';
      default: return 'Glissez la ligne d’un arc pour créer un coude · double-clic sur un coude pour le retirer · R = pivoter la transition · double-clic : place = marquage, transition = franchir, arc = poids';
    }
  });

  constructor() {
    const loop = () => {
      if (this.dirty && this.svgEl?.nativeElement) {
        this.render();
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);

    effect(() => {
      // Redraw uniquement sur changement de réseau, marquage, franchissabilité ou vue.
      void this.petri.places();
      void this.petri.transitions();
      void this.petri.arcs();
      void this.petri.notes();
      void this.petri.marking();
      void this.petri.firable();
      void this.petri.lastFired();
      void this.petri.lastInjected();
      void this.selected();
      void this.zoom(); void this.panX(); void this.panY(); void this.showGrid();
      void this.ghostEnd();
      void this.darkMode();
      this.dirty = true;
    });

    // Rafraîchit pendant la fenêtre d'animation du flash.
    effect(() => {
      const lf = this.petri.lastFired();
      const li = this.petri.lastInjected();
      if (lf || li) {
        const start = performance.now();
        const animate = () => {
          this.dirty = true;
          if (performance.now() - start < FLASH_MS) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    });

    this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
  }

  ngAfterViewInit() {
    this.resizeObserver.observe(this.svgEl.nativeElement.parentElement!);
  }

  ngOnDestroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
  }

  // ── Coordonnées & géométrie ───────────────────────────────────────────────────
  private screenToWorld(clientX: number, clientY: number): Point {
    const rect = this.svgEl.nativeElement.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX()) / this.zoom(),
      y: (clientY - rect.top - this.panY()) / this.zoom(),
    };
  }

  private hitNode(wx: number, wy: number): { id: string; kind: 'place' | 'transition' } | null {
    for (const p of this.petri.places()) {
      if (Math.hypot(p.x - wx, p.y - wy) <= PLACE_R) return { id: p.id, kind: 'place' };
    }
    for (const t of this.petri.transitions()) {
      const hw = (t.horizontal ? TRANS_H : TRANS_W) / 2 + 4;
      const hh = (t.horizontal ? TRANS_W : TRANS_H) / 2 + 4;
      if (Math.abs(t.x - wx) <= hw && Math.abs(t.y - wy) <= hh)
        return { id: t.id, kind: 'transition' };
    }
    return null;
  }

  private hitNote(wx: number, wy: number): string | null {
    for (const n of this.petri.notes()) {
      const b = this.noteBounds.get(n.id);
      if (b && wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return n.id;
    }
    return null;
  }

  /** Point d'angle (poignée) de l'arc sélectionné sous le curseur. */
  private hitWaypoint(wx: number, wy: number): { arcId: string; index: number } | null {
    const sel = this.selected();
    if (!sel) return null;
    const arc = this.petri.arcs().find(a => a.id === sel);
    if (!arc?.waypoints) return null;
    const r = HANDLE_R + 3;
    for (let i = 0; i < arc.waypoints.length; i++) {
      if (Math.hypot(arc.waypoints[i].x - wx, arc.waypoints[i].y - wy) <= r)
        return { arcId: arc.id, index: i };
    }
    return null;
  }

  /** Segment d'arc le plus proche du point (pour sélectionner / créer un coude). */
  private hitArcSegment(wx: number, wy: number): { arcId: string; segIndex: number; point: Point } | null {
    let best: { arcId: string; segIndex: number; point: Point } | null = null;
    let bestD = ARC_HIT;
    for (const a of this.petri.arcs()) {
      const pts = this.arcPolyline(a);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = this.pointSegDist(wx, wy, pts[i], pts[i + 1]);
        if (d < bestD) { bestD = d; best = { arcId: a.id, segIndex: i, point: { x: wx, y: wy } }; }
      }
    }
    return best;
  }

  private pointSegDist(px: number, py: number, a: Point, b: Point): number {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = px - a.x, wy = py - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(px - a.x, py - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(px - b.x, py - b.y);
    const t = c1 / c2;
    return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
  }

  private nodePos(id: string): Point | null {
    const p = this.petri.places().find(p => p.id === id);
    if (p) return { x: p.x, y: p.y };
    const t = this.petri.transitions().find(t => t.id === id);
    return t ? { x: t.x, y: t.y } : null;
  }

  private notePos(id: string): Point | null {
    const n = this.petri.notes().find(n => n.id === id);
    return n ? { x: n.x, y: n.y } : null;
  }

  private entityPos(id: string): Point | null {
    return this.nodePos(id) ?? this.notePos(id);
  }

  private moveEntity(id: string, x: number, y: number) {
    if (this.nodePos(id)) this.petri.updatePosition(id, x, y);
    else this.petri.updateNotePosition(id, x, y);
  }

  /** Ligne brisée complète de l'arc : [départ, ...points d'angle, arrivée],
   *  avec accrochage aux bords des nœuds source et cible. */
  private arcPolyline(a: Arc): Point[] {
    const s = this.nodePos(a.sourceId), t = this.nodePos(a.targetId);
    if (!s || !t) return [];
    const wps = a.waypoints ?? [];
    const firstToward = wps[0] ?? t;
    const lastToward = wps[wps.length - 1] ?? s;
    const start = this.boundaryPoint(a.sourceId, firstToward.x, firstToward.y);
    const end = this.boundaryPoint(a.targetId, lastToward.x, lastToward.y);
    return [start, ...wps, end];
  }

  private boundaryPoint(id: string, towardX: number, towardY: number): Point {
    const pos = this.nodePos(id)!;
    const dx = towardX - pos.x, dy = towardY - pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    if (this.petri.isPlace(id)) {
      return { x: pos.x + ux * PLACE_R, y: pos.y + uy * PLACE_R };
    }
    // transition : intersection avec le rectangle (dimensions selon l'orientation)
    const tr = this.petri.transitions().find(tr => tr.id === id);
    const halfW = (tr?.horizontal ? TRANS_H : TRANS_W) / 2;
    const halfH = (tr?.horizontal ? TRANS_W : TRANS_H) / 2;
    const tx = Math.abs(ux) < 1e-6 ? Infinity : halfW / Math.abs(ux);
    const ty = Math.abs(uy) < 1e-6 ? Infinity : halfH / Math.abs(uy);
    const t = Math.min(tx, ty);
    return { x: pos.x + ux * t, y: pos.y + uy * t };
  }

  // ── Souris ────────────────────────────────────────────────────────────────────
  onMouseDown(e: MouseEvent) {
    this.mouseDown = { x: e.clientX, y: e.clientY };
    this.moved = false;
    this.pendingDrag = null;
    this.pendingPan = false;
    this.pendingHandle = null;
    this.pendingArcGrab = null;
    this.draggingHandle = null;

    if (e.button === 1) { this.panning = true; return; }
    if (e.button !== 0) return;
    if (this.tool() !== 'select') return;

    const { x, y } = this.screenToWorld(e.clientX, e.clientY);

    // Priorité : poignée de coude > nœud > note > ligne d'arc > pan
    const handle = this.hitWaypoint(x, y);
    if (handle) { this.pendingHandle = handle; return; }

    const node = this.hitNode(x, y);
    if (node) {
      const pos = this.nodePos(node.id)!;
      this.pendingDrag = { id: node.id, origX: pos.x, origY: pos.y };
      return;
    }

    const note = this.hitNote(x, y);
    if (note) {
      const pos = this.notePos(note)!;
      this.pendingDrag = { id: note, origX: pos.x, origY: pos.y };
      return;
    }

    const seg = this.hitArcSegment(x, y);
    if (seg) { this.pendingArcGrab = seg; this.selected.set(seg.arcId); return; }

    this.pendingPan = true;
  }

  onMouseMove(e: MouseEvent) {
    if (this.panning && (e.buttons & 4 || e.buttons & 1)) {
      this.panX.update(p => p + e.movementX);
      this.panY.update(p => p + e.movementY);
      return;
    }

    const dist = Math.hypot(e.clientX - this.mouseDown.x, e.clientY - this.mouseDown.y);
    if (dist > DRAG_THRESHOLD) this.moved = true;

    if (this.pendingPan && dist > DRAG_THRESHOLD) { this.panning = true; this.pendingPan = false; }

    // Engage le drag d'un point d'angle existant
    if (this.pendingHandle && dist > DRAG_THRESHOLD && !this.draggingHandle) {
      this.draggingHandle = this.pendingHandle;
      this.pendingHandle = null;
    }
    // Engage la création d'un coude en saisissant la ligne
    if (this.pendingArcGrab && dist > DRAG_THRESHOLD && !this.draggingHandle) {
      const { arcId, segIndex, point } = this.pendingArcGrab;
      this.petri.addArcWaypoint(arcId, segIndex, point);
      this.draggingHandle = { arcId, index: segIndex };
      this.pendingArcGrab = null;
    }
    // Engage le drag d'un nœud / note
    if (this.pendingDrag && dist > DRAG_THRESHOLD && !this.dragging) {
      this.dragging = {
        id: this.pendingDrag.id, startX: this.mouseDown.x, startY: this.mouseDown.y,
        origX: this.pendingDrag.origX, origY: this.pendingDrag.origY,
      };
      this.selected.set(this.pendingDrag.id);
      this.pendingDrag = null;
    }

    if (this.panning) {
      this.panX.update(p => p + e.movementX);
      this.panY.update(p => p + e.movementY);
      return;
    }

    if (this.draggingHandle) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.petri.updateArcWaypoint(this.draggingHandle.arcId, this.draggingHandle.index, w);
      return;
    }

    if (this.dragging) {
      const dx = (e.clientX - this.dragging.startX) / this.zoom();
      const dy = (e.clientY - this.dragging.startY) / this.zoom();
      this.moveEntity(this.dragging.id, this.dragging.origX + dx, this.dragging.origY + dy);
      return;
    }

    if (this.arcSource) {
      this.ghostEnd.set(this.screenToWorld(e.clientX, e.clientY));
    }
  }

  onMouseUp() {
    this.panning = false;
    this.pendingPan = false;
    this.dragging = null;
    this.pendingDrag = null;
    this.pendingHandle = null;
    this.pendingArcGrab = null;
    this.draggingHandle = null;
  }

  onClick(e: MouseEvent) {
    if (this.moved) return; // c'était un drag/pan, pas un clic
    const { x, y } = this.screenToWorld(e.clientX, e.clientY);
    const hit = this.hitNode(x, y);

    switch (this.tool()) {
      case 'place':
        if (!hit) this.petri.addPlace({ x, y });
        return;
      case 'transition':
        if (!hit) this.petri.addTransition({ x, y });
        return;
      case 'inject':
        if (hit?.kind === 'place') this.petri.injectToken(hit.id, 1);
        return;
      case 'arc':
        this.handleArcClick(hit);
        return;
      case 'text': {
        if (hit || this.hitNote(x, y)) return;
        const note = this.petri.addNote({ x, y }, '');
        this.noteOverlay.set({ id: note.id, x: e.clientX, y: e.clientY, value: '', isNew: true });
        return;
      }
      default: { // select
        if (hit) { this.selected.set(hit.id); return; }
        const note = this.hitNote(x, y);
        if (note) { this.selected.set(note); return; }
        const seg = this.hitArcSegment(x, y);
        this.selected.set(seg ? seg.arcId : null);
      }
    }
  }

  private handleArcClick(hit: { id: string; kind: 'place' | 'transition' } | null) {
    if (!hit) { this.arcSource = null; this.ghostEnd.set(null); return; }
    if (!this.arcSource) {
      this.arcSource = hit.id;
      return;
    }
    if (this.arcSource === hit.id) { this.arcSource = null; this.ghostEnd.set(null); return; }
    const created = this.petri.addArc(this.arcSource, hit.id, 1);
    if (!created) {
      // Liaison illégale (place-place / transition-transition / doublon) : on
      // repart de la nouvelle cible comme source potentielle.
      this.arcSource = hit.id;
    } else {
      this.arcSource = null;
      this.ghostEnd.set(null);
    }
  }

  onDblClick(e: MouseEvent) {
    const { x, y } = this.screenToWorld(e.clientX, e.clientY);

    // Double-clic sur une poignée de coude → suppression (rétablit la ligne)
    const wp = this.hitWaypoint(x, y);
    if (wp) { this.petri.removeArcWaypoint(wp.arcId, wp.index); return; }

    const hit = this.hitNode(x, y);
    if (hit?.kind === 'place') {
      const p = this.petri.places().find(p => p.id === hit.id)!;
      this.markingOverlay.set({ id: hit.id, x: e.clientX, y: e.clientY, value: String(p.marking) });
      return;
    }
    if (hit?.kind === 'transition') {
      // Double-clic sur une transition = franchissement manuel (si franchissable).
      this.petri.fireManually(hit.id);
      return;
    }

    const note = this.hitNote(x, y);
    if (note) {
      const n = this.petri.notes().find(n => n.id === note)!;
      this.noteOverlay.set({ id: note, x: e.clientX, y: e.clientY, value: n.text, isNew: false });
      return;
    }

    const seg = this.hitArcSegment(x, y);
    if (seg) {
      const a = this.petri.arcs().find(a => a.id === seg.arcId)!;
      this.weightOverlay.set({ id: a.id, x: e.clientX, y: e.clientY, value: String(a.weight) });
    }
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nz = Math.max(0.3, Math.min(3, this.zoom() * delta));
    const rect = this.svgEl.nativeElement.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const ratio = nz / this.zoom();
    this.panX.update(px => cx - (cx - px) * ratio);
    this.panY.update(py => cy - (cy - py) * ratio);
    this.zoom.set(nz);
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Sur le canevas, Backspace ne doit jamais déclencher la navigation arrière
    // du navigateur — même quand rien n'est sélectionné.
    if (e.key === 'Backspace') e.preventDefault();
    if (e.key === 'Escape') { this.arcSource = null; this.ghostEnd.set(null); this.selected.set(null); }
    if ((e.key === 'r' || e.key === 'R') && this.selected() && this.petri.isTransition(this.selected()!)) {
      this.petri.toggleTransitionOrientation(this.selected()!);
      e.preventDefault();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Backspace supprime l'élément sélectionné (comme Delete) ; sinon, ne rien
      // faire — la navigation arrière est déjà neutralisée plus haut.
      const id = this.selected();
      if (!id) return;
      if (this.petri.arcs().some(a => a.id === id)) this.petri.removeArc(id);
      else if (this.petri.notes().some(n => n.id === id)) this.petri.removeNote(id);
      else this.petri.removeNode(id);
      this.selected.set(null);
    }
  }

  // ── Overlays ────────────────────────────────────────────────────────────────
  confirmMarking() {
    const o = this.markingOverlay();
    if (o) { this.petri.setInitialMarking(o.id, parseInt(o.value, 10) || 0); this.markingOverlay.set(null); }
  }
  confirmWeight() {
    const o = this.weightOverlay();
    if (o) { this.petri.setArcWeight(o.id, parseInt(o.value, 10) || 1); this.weightOverlay.set(null); }
  }
  confirmNote() {
    const o = this.noteOverlay();
    if (!o) return;
    const text = o.value.trim();
    if (text) this.petri.updateNoteText(o.id, o.value);
    else this.petri.removeNote(o.id); // note vide → on la retire
    this.noteOverlay.set(null);
  }
  cancelNote() {
    const o = this.noteOverlay();
    if (o?.isNew) this.petri.removeNote(o.id);
    this.noteOverlay.set(null);
  }

  setTool(t: Tool) {
    this.tool.set(t);
    this.arcSource = null;
    this.ghostEnd.set(null);
  }

  zoomIn() { this.zoom.update(z => Math.min(3, z * 1.2)); }
  zoomOut() { this.zoom.update(z => Math.max(0.3, z / 1.2)); }
  toggleGrid() { this.showGrid.update(v => !v); }
  fit() {
    const nodes = [...this.petri.places(), ...this.petri.transitions()];
    if (!nodes.length) { this.zoom.set(1); this.panX.set(0); this.panY.set(0); return; }
    const rect = this.svgEl.nativeElement.getBoundingClientRect();
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
    const scale = Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY), 2);
    this.zoom.set(Math.max(scale, 0.3));
    this.panX.set((rect.width - (maxX + minX) * scale) / 2);
    this.panY.set((rect.height - (maxY + minY) * scale) / 2);
  }

  // ── Rendu SVG ─────────────────────────────────────────────────────────────────
  private ns = 'http://www.w3.org/2000/svg';

  private el(tag: string): SVGElement {
    return document.createElementNS(this.ns, tag) as SVGElement;
  }

  private render() {
    const svg = this.svgEl.nativeElement;
    svg.innerHTML = '';
    this.noteBounds.clear();
    const dark = this.darkMode();

    // defs : flèches
    const defs = this.el('defs');
    const arcColor = dark ? '#9aa4b0' : '#5b6470';
    const marker = this.el('marker');
    marker.setAttribute('id', 'petri-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '8'); marker.setAttribute('refY', '5');
    marker.setAttribute('orient', 'auto');
    const mpath = this.el('path');
    mpath.setAttribute('d', 'M 0 1 L 9 5 L 0 9 Z');
    mpath.setAttribute('fill', arcColor);
    marker.appendChild(mpath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    if (this.showGrid()) this.drawGrid(svg, dark);

    const g = this.el('g');
    g.setAttribute('transform', `translate(${this.panX()},${this.panY()}) scale(${this.zoom()})`);
    svg.appendChild(g);

    for (const n of this.petri.notes()) this.drawNote(g, n, dark);
    for (const a of this.petri.arcs()) this.drawArc(g, a, arcColor);
    for (const p of this.petri.places()) this.drawPlace(g, p, dark);
    for (const t of this.petri.transitions()) this.drawTransition(g, t, dark);

    // Ghost arc line
    const src = this.arcSource ? this.nodePos(this.arcSource) : null;
    const end = this.ghostEnd();
    if (src && end) {
      const line = this.el('line');
      line.setAttribute('x1', String(src.x)); line.setAttribute('y1', String(src.y));
      line.setAttribute('x2', String(end.x)); line.setAttribute('y2', String(end.y));
      line.setAttribute('stroke', '#e0a92e');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6 3');
      line.setAttribute('pointer-events', 'none');
      g.appendChild(line);
    }
  }

  private drawGrid(svg: SVGSVGElement, dark: boolean) {
    const rect = svg.getBoundingClientRect();
    const pat = this.el('pattern');
    pat.setAttribute('id', 'petri-grid');
    pat.setAttribute('width', '20'); pat.setAttribute('height', '20');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    const dot = this.el('circle');
    dot.setAttribute('cx', '1'); dot.setAttribute('cy', '1'); dot.setAttribute('r', '1');
    dot.setAttribute('fill', dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)');
    pat.appendChild(dot);
    svg.querySelector('defs')!.appendChild(pat);
    const bg = this.el('rect');
    bg.setAttribute('width', String(rect.width || 800));
    bg.setAttribute('height', String(rect.height || 600));
    bg.setAttribute('fill', 'url(#petri-grid)');
    svg.appendChild(bg);
  }

  private drawArc(g: SVGElement, a: Arc, color: string) {
    const pts = this.arcPolyline(a);
    if (pts.length < 2) return;
    const isSel = this.selected() === a.id;
    const ptsStr = pts.map(p => `${p.x},${p.y}`).join(' ');

    const poly = this.el('polyline');
    poly.setAttribute('points', ptsStr);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', isSel ? '#e0a92e' : color);
    poly.setAttribute('stroke-width', isSel ? '3' : '2');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('marker-end', 'url(#petri-arrow)');
    g.appendChild(poly);

    // zone de clic élargie
    const hit = this.el('polyline');
    hit.setAttribute('points', ptsStr);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    g.appendChild(hit);

    // badge de poids (milieu de la ligne brisée)
    if (a.weight > 1) {
      const mid = Math.max(0, Math.floor((pts.length - 1) / 2));
      const mx = (pts[mid].x + pts[mid + 1].x) / 2;
      const my = (pts[mid].y + pts[mid + 1].y) / 2;
      const badge = this.el('text');
      badge.setAttribute('x', String(mx)); badge.setAttribute('y', String(my - 6));
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('fill', color);
      badge.setAttribute('font-size', '13'); badge.setAttribute('font-weight', '700');
      badge.textContent = String(a.weight);
      g.appendChild(badge);
    }

    // poignées de points d'angle (arc sélectionné)
    if (isSel && a.waypoints?.length) {
      for (const w of a.waypoints) {
        const h = this.el('circle');
        h.setAttribute('cx', String(w.x)); h.setAttribute('cy', String(w.y));
        h.setAttribute('r', String(HANDLE_R));
        h.setAttribute('fill', '#e0a92e');
        h.setAttribute('stroke', '#fff');
        h.setAttribute('stroke-width', '1.5');
        g.appendChild(h);
      }
    }
  }

  private drawNote(g: SVGElement, note: TextNote, dark: boolean) {
    const grp = this.el('g');
    grp.setAttribute('transform', `translate(${note.x},${note.y})`);
    const isSel = this.selected() === note.id;
    const empty = !note.text.trim();

    const text = this.el('text');
    text.setAttribute('x', '0'); text.setAttribute('y', '0');
    text.setAttribute('dominant-baseline', 'text-before-edge');
    text.setAttribute('fill', empty ? (dark ? '#6f7a86' : '#9aa4b0')
                                    : (dark ? '#dbe2ea' : '#2b333c'));
    text.setAttribute('font-size', '13');
    text.setAttribute('font-style', empty ? 'italic' : 'normal');

    const lines = empty ? ['(texte…)'] : note.text.split('\n');
    lines.forEach((ln, i) => {
      const tspan = this.el('tspan');
      tspan.setAttribute('x', '0');
      tspan.setAttribute('dy', i === 0 ? '0' : '1.25em');
      tspan.textContent = ln || ' ';
      text.appendChild(tspan);
    });

    grp.appendChild(text);
    g.appendChild(grp);

    // Fond + bordure calculés d'après la boîte englobante du texte.
    const bb = (text as SVGTextElement).getBBox();
    const pad = 5;
    const bx = bb.x - pad, by = bb.y - pad, bw = bb.width + pad * 2, bh = bb.height + pad * 2;
    const rect = this.el('rect');
    rect.setAttribute('x', String(bx)); rect.setAttribute('y', String(by));
    rect.setAttribute('width', String(bw)); rect.setAttribute('height', String(bh));
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)');
    rect.setAttribute('stroke', isSel ? '#e0a92e' : (dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'));
    rect.setAttribute('stroke-width', isSel ? '2' : '1');
    if (isSel) rect.setAttribute('stroke-dasharray', '');
    grp.insertBefore(rect, text);

    this.noteBounds.set(note.id, { x: note.x + bx, y: note.y + by, w: bw, h: bh });
  }

  private drawPlace(g: SVGElement, p: Place, dark: boolean) {
    const grp = this.el('g');
    grp.setAttribute('transform', `translate(${p.x},${p.y})`);
    if (p.description) {
      const title = this.el('title');
      title.textContent = `${p.label} : ${p.description}`;
      grp.appendChild(title);
    }
    const isSel = this.selected() === p.id;
    const injected = this.petri.lastInjected();
    const flashInject = injected && injected.id === p.id && performance.now() - injected.ts < FLASH_MS;

    const circle = this.el('circle');
    circle.setAttribute('r', String(PLACE_R));
    circle.setAttribute('fill', dark ? '#1c2530' : '#ffffff');
    circle.setAttribute('stroke', flashInject ? '#38b26a' : (isSel ? '#e0a92e' : (dark ? '#7f8c9b' : '#41505f')));
    circle.setAttribute('stroke-width', flashInject ? '4' : (isSel ? '3' : '2'));
    grp.appendChild(circle);

    const tokens = this.petri.marking()[this.petri.places().indexOf(p)] ?? 0;
    this.drawTokens(grp, tokens, dark);

    // label au-dessus
    const label = this.el('text');
    label.setAttribute('x', '0'); label.setAttribute('y', String(-PLACE_R - 8));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', dark ? '#c7d0da' : '#333b45');
    label.setAttribute('font-size', '12'); label.setAttribute('font-weight', '600');
    label.textContent = p.label;
    grp.appendChild(label);

    g.appendChild(grp);
  }

  private drawTokens(grp: SVGElement, n: number, dark: boolean) {
    const color = dark ? '#e8edf2' : '#1a2530';
    if (n <= 0) return;
    if (n <= 4) {
      // disposition en jetons
      const offsets: Record<number, [number, number][]> = {
        1: [[0, 0]],
        2: [[-7, 0], [7, 0]],
        3: [[0, -7], [-7, 6], [7, 6]],
        4: [[-7, -7], [7, -7], [-7, 7], [7, 7]],
      };
      for (const [dx, dy] of offsets[n]) {
        const c = this.el('circle');
        c.setAttribute('cx', String(dx)); c.setAttribute('cy', String(dy));
        c.setAttribute('r', '4'); c.setAttribute('fill', color);
        grp.appendChild(c);
      }
    } else {
      const t = this.el('text');
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('fill', color); t.setAttribute('font-size', '16'); t.setAttribute('font-weight', '700');
      t.textContent = String(n);
      grp.appendChild(t);
    }
  }

  private drawTransition(g: SVGElement, t: Transition, dark: boolean) {
    const grp = this.el('g');
    grp.setAttribute('transform', `translate(${t.x},${t.y})`);
    if (t.description) {
      const title = this.el('title');
      title.textContent = `${t.label} : ${t.description}`;
      grp.appendChild(title);
    }
    const isSel = this.selected() === t.id;
    const firable = this.petri.firable().has(t.id);
    const lf = this.petri.lastFired();
    const flash = lf && lf.ids.includes(t.id) && performance.now() - lf.ts < FLASH_MS;

    const horizontal = !!t.horizontal;
    const w = horizontal ? TRANS_H : TRANS_W;
    const h = horizontal ? TRANS_W : TRANS_H;

    const rect = this.el('rect');
    rect.setAttribute('x', String(-w / 2)); rect.setAttribute('y', String(-h / 2));
    rect.setAttribute('width', String(w)); rect.setAttribute('height', String(h));
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', flash ? '#e0a92e' : (dark ? '#2a3340' : '#41505f'));
    // Mise en évidence « live » des transitions franchissables (même à l'arrêt).
    rect.setAttribute('stroke', firable ? '#38b26a' : (isSel ? '#e0a92e' : 'transparent'));
    rect.setAttribute('stroke-width', firable || isSel ? '3' : '0');
    grp.appendChild(rect);

    const label = this.el('text');
    label.setAttribute('fill', dark ? '#c7d0da' : '#333b45');
    label.setAttribute('font-size', '12'); label.setAttribute('font-weight', '600');
    if (horizontal) {
      // étiquette sous la barre horizontale
      label.setAttribute('x', '0'); label.setAttribute('y', String(h / 2 + 12));
      label.setAttribute('text-anchor', 'middle');
    } else {
      // étiquette à droite de la barre verticale
      label.setAttribute('x', String(w / 2 + 6)); label.setAttribute('y', '0');
      label.setAttribute('dominant-baseline', 'central');
    }
    label.textContent = t.label;
    grp.appendChild(label);

    g.appendChild(grp);
  }
}
