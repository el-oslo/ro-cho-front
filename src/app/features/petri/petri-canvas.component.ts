import {
  Component, ElementRef, ViewChild, inject, effect, input, signal, computed,
  OnDestroy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PetriService } from '../../core/services/petri.service';
import { Arc, Place, Transition } from '../../core/models/petri.models';

type Tool = 'select' | 'place' | 'transition' | 'arc' | 'inject';

const PLACE_R = 24;
const TRANS_W = 16;
const TRANS_H = 46;
const DRAG_THRESHOLD = 6;
const FLASH_MS = 450;

@Component({
  selector: 'app-petri-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  // Ghost line pendant la création d'un arc
  private arcSource: string | null = null;
  private ghostEnd = signal<{ x: number; y: number } | null>(null);

  // Drag state
  private pendingDrag: { id: string; origX: number; origY: number } | null = null;
  private dragging: { id: string; startX: number; startY: number; origX: number; origY: number } | null = null;
  private pendingPan = false;
  private panning = false;
  private mouseDown = { x: 0, y: 0 };
  private moved = false;

  private rafId: number | null = null;
  private dirty = true;
  private resizeObserver: ResizeObserver;

  readonly toolHint = computed(() => {
    switch (this.tool()) {
      case 'place': return 'Cliquez pour ajouter une place';
      case 'transition': return 'Cliquez pour ajouter une transition';
      case 'arc': return 'Cliquez une place puis une transition (ou l’inverse) pour relier';
      case 'inject': return 'Cliquez une place pour injecter un jeton (+1)';
      default: return 'Glissez pour déplacer · double-clic : place = marquage, transition = franchir, arc = poids';
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

  // ── Coordonnées ──────────────────────────────────────────────────────────────
  private screenToWorld(clientX: number, clientY: number) {
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
      if (Math.abs(t.x - wx) <= TRANS_W / 2 + 4 && Math.abs(t.y - wy) <= TRANS_H / 2 + 4)
        return { id: t.id, kind: 'transition' };
    }
    return null;
  }

  private hitArc(wx: number, wy: number): string | null {
    for (const a of this.petri.arcs()) {
      const s = this.nodePos(a.sourceId);
      const t = this.nodePos(a.targetId);
      if (!s || !t) continue;
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      if (Math.hypot(mx - wx, my - wy) < 14) return a.id;
    }
    return null;
  }

  private nodePos(id: string): { x: number; y: number } | null {
    const p = this.petri.places().find(p => p.id === id);
    if (p) return { x: p.x, y: p.y };
    const t = this.petri.transitions().find(t => t.id === id);
    return t ? { x: t.x, y: t.y } : null;
  }

  // ── Souris ────────────────────────────────────────────────────────────────────
  onMouseDown(e: MouseEvent) {
    this.mouseDown = { x: e.clientX, y: e.clientY };
    this.moved = false;
    this.pendingDrag = null;
    this.pendingPan = false;

    if (e.button === 1) { this.panning = true; return; }
    if (e.button !== 0) return;

    const { x, y } = this.screenToWorld(e.clientX, e.clientY);
    const hit = this.hitNode(x, y);

    if (this.tool() === 'select' && hit) {
      const pos = this.nodePos(hit.id)!;
      this.pendingDrag = { id: hit.id, origX: pos.x, origY: pos.y };
    } else if (this.tool() === 'select') {
      this.pendingPan = true;
    }
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

    if (this.dragging) {
      const dx = (e.clientX - this.dragging.startX) / this.zoom();
      const dy = (e.clientY - this.dragging.startY) / this.zoom();
      this.petri.updatePosition(this.dragging.id, this.dragging.origX + dx, this.dragging.origY + dy);
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
      default: // select
        if (hit) {
          this.selected.set(hit.id);
        } else {
          const arc = this.hitArc(x, y);
          this.selected.set(arc);
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
    const arc = this.hitArc(x, y);
    if (arc) {
      const a = this.petri.arcs().find(a => a.id === arc)!;
      this.weightOverlay.set({ id: arc, x: e.clientX, y: e.clientY, value: String(a.weight) });
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
    if (e.key === 'Escape') { this.arcSource = null; this.ghostEnd.set(null); this.selected.set(null); }
    if (e.key === 'Delete' && this.selected()) {
      const id = this.selected()!;
      if (this.petri.arcs().some(a => a.id === id)) this.petri.removeArc(id);
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

  private boundaryPoint(id: string, towardX: number, towardY: number): { x: number; y: number } {
    const pos = this.nodePos(id)!;
    const dx = towardX - pos.x, dy = towardY - pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    if (this.petri.isPlace(id)) {
      return { x: pos.x + ux * PLACE_R, y: pos.y + uy * PLACE_R };
    }
    // transition : intersection avec le rectangle
    const tx = Math.abs(ux) < 1e-6 ? Infinity : (TRANS_W / 2) / Math.abs(ux);
    const ty = Math.abs(uy) < 1e-6 ? Infinity : (TRANS_H / 2) / Math.abs(uy);
    const t = Math.min(tx, ty);
    return { x: pos.x + ux * t, y: pos.y + uy * t };
  }

  private drawArc(g: SVGElement, a: Arc, color: string) {
    const s = this.nodePos(a.sourceId), t = this.nodePos(a.targetId);
    if (!s || !t) return;
    const start = this.boundaryPoint(a.sourceId, t.x, t.y);
    const end = this.boundaryPoint(a.targetId, s.x, s.y);
    const isSel = this.selected() === a.id;

    const line = this.el('line');
    line.setAttribute('x1', String(start.x)); line.setAttribute('y1', String(start.y));
    line.setAttribute('x2', String(end.x)); line.setAttribute('y2', String(end.y));
    line.setAttribute('stroke', isSel ? '#e0a92e' : color);
    line.setAttribute('stroke-width', isSel ? '3' : '2');
    line.setAttribute('marker-end', 'url(#petri-arrow)');
    g.appendChild(line);

    // zone de clic élargie
    const hit = line.cloneNode() as SVGLineElement;
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    hit.removeAttribute('marker-end');
    g.appendChild(hit);

    if (a.weight > 1) {
      const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
      const badge = this.el('text');
      badge.setAttribute('x', String(mx)); badge.setAttribute('y', String(my - 6));
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('fill', color);
      badge.setAttribute('font-size', '13'); badge.setAttribute('font-weight', '700');
      badge.textContent = String(a.weight);
      g.appendChild(badge);
    }
  }

  private drawPlace(g: SVGElement, p: Place, dark: boolean) {
    const grp = this.el('g');
    grp.setAttribute('transform', `translate(${p.x},${p.y})`);
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
    const isSel = this.selected() === t.id;
    const firable = this.petri.firable().has(t.id);
    const lf = this.petri.lastFired();
    const flash = lf && lf.ids.includes(t.id) && performance.now() - lf.ts < FLASH_MS;

    const rect = this.el('rect');
    rect.setAttribute('x', String(-TRANS_W / 2)); rect.setAttribute('y', String(-TRANS_H / 2));
    rect.setAttribute('width', String(TRANS_W)); rect.setAttribute('height', String(TRANS_H));
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', flash ? '#e0a92e' : (dark ? '#2a3340' : '#41505f'));
    // Mise en évidence « live » des transitions franchissables (même à l'arrêt).
    rect.setAttribute('stroke', firable ? '#38b26a' : (isSel ? '#e0a92e' : 'transparent'));
    rect.setAttribute('stroke-width', firable || isSel ? '3' : '0');
    grp.appendChild(rect);

    const label = this.el('text');
    label.setAttribute('x', String(TRANS_W / 2 + 6)); label.setAttribute('y', '0');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('fill', dark ? '#c7d0da' : '#333b45');
    label.setAttribute('font-size', '12'); label.setAttribute('font-weight', '600');
    label.textContent = t.label;
    grp.appendChild(label);

    g.appendChild(grp);
  }
}
